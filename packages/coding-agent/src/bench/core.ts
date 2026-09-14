/**
 * A-Coder Bench core: task discovery, run execution, grading, recording.
 *
 * Shared by the standalone `bench/runner.ts` script and the interactive
 * `a-coder-cli bench` TUI. Execution model: each run spawns this same CLI
 * headless (`--mode json`) in a fresh copy of the task repo, enforces the
 * task timeout, then runs the hidden grader from the task directory against
 * the sandbox (the grader is never visible to the agent).
 */

import { spawn } from "node:child_process";
import fs, { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { STARTER_TASK_FILES } from "./starter-tasks.generated.ts";
import type {
	BenchChildCommand,
	BenchRunResult,
	BenchRunStats,
	BenchTask,
	RunTaskOptions,
	SpawnOutcome,
} from "./types.ts";

/** True when running as a compiled Bun single-file executable. */
const isBunBinary =
	import.meta.url.includes("$bunfs") || import.meta.url.includes("~BUN") || import.meta.url.includes("%7EBUN");

/** Grace period after the timeout before SIGKILL. */
const KILL_GRACE_MS = 5000;

/** Timeout for the grader itself. */
export const GRADER_TIMEOUT_MS = 60_000;

/** Tools whose failure indicates an edit-format / tool-usage problem. */
const EDIT_TOOLS = new Set(["edit", "write"]);

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/** Walk up from startDir (default cwd) looking for a bench/tasks directory. */
export function findBenchDir(startDir: string = process.cwd()): string | undefined {
	let dir = startDir;
	while (true) {
		const candidate = join(dir, "bench", "tasks");
		if (existsSync(candidate)) return join(dir, "bench");
		const parent = dirname(dir);
		if (parent === dir) return undefined;
		dir = parent;
	}
}

export function tasksDir(benchDir: string): string {
	return join(benchDir, "tasks");
}

export function loadTasks(benchDir: string): BenchTask[] {
	const dir = tasksDir(benchDir);
	if (!existsSync(dir)) return [];
	return fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => join(dir, e.name, "task.json"))
		.filter((p) => existsSync(p))
		.map((p) => JSON.parse(fs.readFileSync(p, "utf8")) as BenchTask)
		.sort((a, b) => a.id.localeCompare(b.id));
}

export function resultsPath(benchDir: string): string {
	return join(benchDir, "results.jsonl");
}

export interface MaterializeSummary {
	benchDir: string;
	written: number;
	skipped: number;
	taskIds: string[];
}

/**
 * Write the embedded starter tasks into destDir (typically <cwd>/bench).
 * Never overwrites existing files, so user-modified tasks survive.
 */
export function materializeStarterTasks(destDir: string): MaterializeSummary {
	const tasksRoot = join(destDir, "tasks");
	fs.mkdirSync(tasksRoot, { recursive: true });
	let written = 0;
	let skipped = 0;
	for (const [relative, content] of Object.entries(STARTER_TASK_FILES)) {
		const target = join(tasksRoot, relative);
		if (existsSync(target)) {
			skipped++;
			continue;
		}
		fs.mkdirSync(dirname(target), { recursive: true });
		fs.writeFileSync(target, content);
		written++;
	}
	return { benchDir: destDir, written, skipped, taskIds: loadTasks(destDir).map((t) => t.id) };
}

/**
 * Resolve the bench directory to use: an explicit preferred dir (materialized
 * when it has no tasks yet) or an existing bench/tasks near cwd; without a
 * checkout, the embedded starter tasks are materialized into <cwd>/bench.
 */
export function ensureBenchDir(preferred?: string, materialize = true): MaterializeSummary | undefined {
	if (!preferred) {
		const existing = findBenchDir();
		if (existing)
			return { benchDir: existing, written: 0, skipped: 0, taskIds: loadTasks(existing).map((t) => t.id) };
	}
	const target = preferred ?? join(process.cwd(), "bench");
	if (existsSync(join(target, "tasks")))
		return { benchDir: target, written: 0, skipped: 0, taskIds: loadTasks(target).map((t) => t.id) };
	if (!materialize) return undefined;
	return materializeStarterTasks(target);
}

export function appendResult(benchDir: string, result: BenchRunResult): void {
	fs.appendFileSync(resultsPath(benchDir), `${JSON.stringify(result)}\n`);
}

export function loadResults(benchDir: string): BenchRunResult[] {
	const path = resultsPath(benchDir);
	if (!existsSync(path)) return [];
	return fs
		.readFileSync(path, "utf8")
		.split("\n")
		.filter((line) => line.trim().startsWith("{"))
		.map((line) => JSON.parse(line) as BenchRunResult);
}

// ---------------------------------------------------------------------------
// Model spec / endpoint wiring
// ---------------------------------------------------------------------------

export interface BenchModelSpec {
	provider: string;
	modelId: string;
}

export function parseBenchModelSpec(model: string): BenchModelSpec {
	const slash = model.indexOf("/");
	if (slash <= 0 || slash === model.length - 1) {
		throw new Error(`model must be <provider>/<model-id>, got: ${model}`);
	}
	return { provider: model.slice(0, slash), modelId: model.slice(slash + 1) };
}

/**
 * Write a per-run agent dir with a models.json custom provider so the child
 * CLI talks to a self-hosted endpoint (vLLM, SGLang, LM Studio, ollama serve).
 * Returns the agent dir to expose as A_CODER_CLI_CODING_AGENT_DIR.
 */
export function writeEndpointAgentDir(
	runDir: string,
	spec: BenchModelSpec,
	endpoint: string,
	apiKey: string,
	api: string,
): string {
	const agentDir = join(runDir, "agent");
	const modelsJson = {
		providers: {
			[spec.provider]: {
				name: spec.provider,
				baseUrl: endpoint,
				apiKey: apiKey,
				api: api,
				models: [{ id: spec.modelId, name: spec.modelId }],
			},
		},
	};
	fs.mkdirSync(agentDir, { recursive: true });
	fs.writeFileSync(join(agentDir, "models.json"), `${JSON.stringify(modelsJson, null, 2)}\n`);
	return agentDir;
}

/**
 * Resolve how to re-exec the coding-agent CLI for a bench child run. Mirrors
 * the cloud runner's approach: a sibling binary for compiled Bun builds, the
 * TS entry with the inherited tsx loader flags in dev, or the package's dist
 * CLI otherwise.
 */
export function resolveBenchChildCommand(): BenchChildCommand {
	if (isBunBinary) {
		// Compiled bun binary: process.execPath IS the CLI. Do not look for a
		// sibling binary - installed layouts name it "pi" or "a-coder-cli"
		// depending on the install path, and re-exec'ing ourselves is layout-
		// independent. User args flow through as-is.
		return { command: process.execPath, baseArgs: [] };
	}
	// Walk up from this module to the coding-agent package root.
	let dir = dirname(fileURLToPath(import.meta.url));
	while (dir !== dirname(dir) && !existsSync(join(dir, "package.json"))) {
		dir = dirname(dir);
	}
	if (process.argv[1]?.endsWith(".ts")) {
		// Dev: re-run the TS CLI entry with the tsx loader flags we inherited.
		return { command: process.execPath, baseArgs: [...process.execArgv, join(dir, "src", "cli.ts")] };
	}
	return { command: process.execPath, baseArgs: [join(dir, "dist", "cli.js")] };
}

// ---------------------------------------------------------------------------
// Event-stream parsing
// ---------------------------------------------------------------------------

interface AgentEventLike {
	type: string;
	[key: string]: unknown;
}

interface UsageLike {
	input?: number;
	output?: number;
	totalTokens?: number;
}

function asUsage(value: unknown): { input: number; output: number; total: number } {
	const u = (value ?? {}) as UsageLike;
	return {
		input: typeof u.input === "number" ? u.input : 0,
		output: typeof u.output === "number" ? u.output : 0,
		total: typeof u.totalTokens === "number" ? u.totalTokens : 0,
	};
}

/** Extract the last assistant text block from agent_end messages. */
export function extractFinalText(messages: unknown): string {
	if (!Array.isArray(messages)) return "";
	for (let i = messages.length - 1; i >= 0; i--) {
		const msg = messages[i] as { role?: string; content?: unknown } | null;
		if (!msg || msg.role !== "assistant" || !Array.isArray(msg.content)) continue;
		const texts = (msg.content as Array<{ type?: string; text?: string }>)
			.filter((block) => block && block.type === "text" && typeof block.text === "string")
			.map((block) => block.text as string);
		if (texts.length > 0) return texts.join("\n").trim();
	}
	return "";
}

export function emptyRunStats(): BenchRunStats {
	return {
		toolCalls: 0,
		toolErrors: 0,
		editFailures: 0,
		turns: 0,
		usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
		finalText: "",
	};
}

export function parseEventStream(stdout: string): BenchRunStats {
	const stats = emptyRunStats();
	for (const line of stdout.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("{")) continue;
		let event: AgentEventLike;
		try {
			event = JSON.parse(trimmed) as AgentEventLike;
		} catch {
			continue;
		}
		switch (event.type) {
			case "tool_execution_end": {
				stats.toolCalls++;
				if (event.isError === true) {
					stats.toolErrors++;
					if (typeof event.toolName === "string" && EDIT_TOOLS.has(event.toolName)) {
						stats.editFailures++;
					}
				}
				break;
			}
			case "turn_end": {
				stats.turns++;
				// Usage is reported on the turn's assistant message.
				const msg = event.message as { usage?: unknown } | undefined;
				const turnUsage = asUsage(msg?.usage);
				stats.usage.inputTokens += turnUsage.input;
				stats.usage.outputTokens += turnUsage.output;
				stats.usage.totalTokens += turnUsage.total;
				break;
			}
			case "agent_end": {
				stats.finalText = extractFinalText(event.messages);
				break;
			}
			default:
				break;
		}
	}
	return stats;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

function spawnWithTimeout(
	cmd: string,
	args: string[],
	opts: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<SpawnOutcome> {
	return new Promise((resolve) => {
		const child = spawn(cmd, args, {
			cwd: opts.cwd,
			env: opts.env ?? process.env,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill("SIGTERM");
			setTimeout(() => {
				if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
			}, KILL_GRACE_MS);
		}, opts.timeoutMs);
		child.on("close", (code) => {
			clearTimeout(timer);
			resolve({ stdout, stderr, exitCode: code, timedOut });
		});
	});
}

function parseGradeDetail(stdout: string): unknown {
	const trimmed = stdout.trim();
	if (!trimmed) return null;
	try {
		return JSON.parse(trimmed);
	} catch {
		return trimmed.slice(0, 2000);
	}
}

/** Run one (task x run) combination and record the result. */
export async function runTaskOnce(options: RunTaskOptions): Promise<BenchRunResult> {
	const { benchDir, task, provider, modelId } = options;
	const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}_${provider}_${modelId}_${task.id}_r${options.runIndex}`;
	const runDir = join(benchDir, "runs", runId);
	const repoDir = join(runDir, "repo");
	fs.mkdirSync(runDir, { recursive: true });
	fs.cpSync(join(tasksDir(benchDir), task.id, "repo"), repoDir, { recursive: true });

	const env: NodeJS.ProcessEnv = { ...process.env };
	if (options.endpoint) {
		env.A_CODER_CLI_CODING_AGENT_DIR = writeEndpointAgentDir(
			runDir,
			{ provider, modelId },
			options.endpoint,
			options.apiKey,
			options.api,
		);
	}

	const args = [
		...options.child.baseArgs,
		"--mode",
		"json",
		"--no-session",
		"--permission-mode",
		"allow",
		"--provider",
		provider,
		"--model",
		modelId,
		"-p",
		task.instruction,
	];
	const startedAt = Date.now();
	const agent = await spawnWithTimeout(options.child.command, args, {
		cwd: repoDir,
		env,
		timeoutMs: task.timeoutSeconds * 1000,
	});
	const durationMs = Date.now() - startedAt;

	fs.writeFileSync(join(runDir, "events.jsonl"), agent.stdout);

	const stats = parseEventStream(agent.stdout);

	// Hidden grader: lives in the task dir, runs against the sandbox repo.
	const graderPath = join(tasksDir(benchDir), task.id, task.grader);
	let gradeDetail: unknown = null;
	let graderExitCode: number | null = null;
	if (!agent.timedOut) {
		const graderRun = await spawnWithTimeout(process.execPath, [graderPath], {
			cwd: repoDir,
			timeoutMs: GRADER_TIMEOUT_MS,
		});
		graderExitCode = graderRun.exitCode;
		gradeDetail =
			parseGradeDetail(graderRun.stdout) ??
			(graderRun.exitCode !== 0 ? graderRun.stderr.trim().slice(0, 2000) : null);
	}

	const result: BenchRunResult = {
		runId,
		timestamp: new Date().toISOString(),
		model: `${provider}/${modelId}`,
		endpoint: options.endpoint,
		taskId: task.id,
		taskTags: task.tags,
		runIndex: options.runIndex,
		pass: !agent.timedOut && graderExitCode === 0,
		timedOut: agent.timedOut,
		agentExitCode: agent.exitCode,
		graderExitCode,
		gradeDetail,
		durationMs,
		stats,
	};
	if (agent.exitCode !== 0 && !agent.timedOut) {
		result.error = `agent exited ${agent.exitCode}: ${agent.stderr.trim().split("\n").slice(-3).join(" | ").slice(0, 500)}`;
	}

	fs.writeFileSync(join(runDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
	appendResult(benchDir, result);
	return result;
}
