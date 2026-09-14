/**
 * A-Coder Bench runner.
 *
 * Runs (model x task x run) combinations against the a-coder-cli agent loop:
 *   1. copies the task repo into a fresh per-run sandbox
 *   2. spawns `pi` headless (--mode json) with the task instruction
 *   3. enforces the task timeout
 *   4. runs the hidden grader against the sandbox
 *   5. records result.json + appends to bench/results.jsonl
 *
 * Zero dependencies. Run with the repo's tsx:
 *   node_modules/.bin/tsx bench/runner.ts --model ollama/gemma3:1b
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface TaskConfig {
	id: string;
	title: string;
	instruction: string;
	tags: string[];
	timeoutSeconds: number;
	grader: string;
}

interface RunUsage {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
}

interface RunStats {
	toolCalls: number;
	toolErrors: number;
	editFailures: number;
	turns: number;
	usage: RunUsage;
	finalText: string;
}

interface RunResult {
	runId: string;
	timestamp: string;
	model: string;
	endpoint?: string;
	taskId: string;
	taskTags: string[];
	runIndex: number;
	pass: boolean;
	timedOut: boolean;
	agentExitCode: number | null;
	graderExitCode: number | null;
	gradeDetail: unknown;
	durationMs: number;
	stats: RunStats;
	error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BENCH_DIR = path.resolve(import.meta.dirname);
const REPO_ROOT = path.resolve(BENCH_DIR, "..");
const TASKS_DIR = path.join(BENCH_DIR, "tasks");
const RUNS_DIR = path.join(BENCH_DIR, "runs");
const RESULTS_PATH = path.join(BENCH_DIR, "results.jsonl");
const PI_ENTRY = path.join(REPO_ROOT, "packages", "coding-agent", "src", "cli.ts");
const TSX_BIN = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");

/** Tools whose failure indicates an edit-format / tool-usage problem. */
const EDIT_TOOLS = new Set(["edit", "write"]);

/** Grace period after the timeout before SIGKILL. */
const KILL_GRACE_MS = 5000;

/** Timeout for the grader itself. */
const GRADER_TIMEOUT_MS = 60_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
	return new Date().toISOString();
}

function listTasks(): TaskConfig[] {
	if (!fs.existsSync(TASKS_DIR)) return [];
	return fs
		.readdirSync(TASKS_DIR, { withFileTypes: true })
		.filter((e) => e.isDirectory())
		.map((e) => path.join(TASKS_DIR, e.name, "task.json"))
		.filter((p) => fs.existsSync(p))
		.map((p) => JSON.parse(fs.readFileSync(p, "utf8")) as TaskConfig)
		.sort((a, b) => a.id.localeCompare(b.id));
}

function copyDir(src: string, dest: string): void {
	fs.cpSync(src, dest, { recursive: true });
}

/** Spawn a process, collect stdout/stderr, enforce a hard timeout. */
interface SpawnResult {
	stdout: string;
	stderr: string;
	exitCode: number | null;
	timedOut: boolean;
}

function spawnWithTimeout(
	cmd: string,
	args: string[],
	opts: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<SpawnResult> {
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

function asUsage(value: unknown): RunUsage {
	const u = (value ?? {}) as UsageLike;
	return {
		inputTokens: typeof u.input === "number" ? u.input : 0,
		outputTokens: typeof u.output === "number" ? u.output : 0,
		totalTokens: typeof u.totalTokens === "number" ? u.totalTokens : 0,
	};
}

/** Extract the last assistant text block from agent_end messages. */
function extractFinalText(messages: unknown): string {
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

function parseEventStream(stdout: string, startedAt: number): RunStats {
	const stats: RunStats = {
		toolCalls: 0,
		toolErrors: 0,
		editFailures: 0,
		turns: 0,
		usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
		finalText: "",
	};
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
				stats.usage.inputTokens += turnUsage.inputTokens;
				stats.usage.outputTokens += turnUsage.outputTokens;
				stats.usage.totalTokens += turnUsage.totalTokens;
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
	// agent_end also fires with usage on some paths; finalText already handled.
	void startedAt;
	return stats;
}

// ---------------------------------------------------------------------------
// Model / endpoint handling
// ---------------------------------------------------------------------------

interface ModelSpec {
	provider: string;
	modelId: string;
}

function parseModelSpec(model: string): ModelSpec {
	const slash = model.indexOf("/");
	if (slash <= 0 || slash === model.length - 1) {
		throw new Error(`--model must be <provider>/<model-id>, got: ${model}`);
	}
	return { provider: model.slice(0, slash), modelId: model.slice(slash + 1) };
}

/**
 * Write a per-run agent dir with a models.json custom provider so the CLI
 * talks to a self-hosted endpoint (vLLM, SGLang, ollama serve, ...).
 */
function writeEndpointAgentDir(runDir: string, spec: ModelSpec, endpoint: string, apiKey: string, api: string): string {
	const agentDir = path.join(runDir, "agent");
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
	fs.writeFileSync(path.join(agentDir, "models.json"), JSON.stringify(modelsJson, null, 2) + "\n");
	return agentDir;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

interface RunOutcome {
	result: RunResult;
}

async function runOnce(
	task: TaskConfig,
	spec: ModelSpec,
	runIndex: number,
	opts: { endpoint?: string; apiKey: string; api: string },
): Promise<RunOutcome> {
	const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}_${spec.provider}_${spec.modelId}_${task.id}_r${runIndex}`;
	const runDir = path.join(RUNS_DIR, runId);
	const repoDir = path.join(runDir, "repo");
	fs.mkdirSync(runDir, { recursive: true });
	copyDir(path.join(TASKS_DIR, task.id, "repo"), repoDir);

	const env: NodeJS.ProcessEnv = { ...process.env };
	if (opts.endpoint) {
		const agentDir = writeEndpointAgentDir(runDir, spec, opts.endpoint, opts.apiKey, opts.api);
		env.A_CODER_CLI_CODING_AGENT_DIR = agentDir;
	}

	const args = [
		PI_ENTRY,
		"--mode",
		"json",
		"--no-session",
		"--permission-mode",
		"allow",
		"--provider",
		spec.provider,
		"--model",
		spec.modelId,
		"-p",
		task.instruction,
	];
	const startedAt = Date.now();
	const agent = await spawnWithTimeout(TSX_BIN, args, {
		cwd: repoDir,
		env,
		timeoutMs: task.timeoutSeconds * 1000,
	});
	const durationMs = Date.now() - startedAt;

	fs.writeFileSync(path.join(runDir, "events.jsonl"), agent.stdout);

	const stats = parseEventStream(agent.stdout, startedAt);
	if (agent.timedOut) {
		stats.finalText = stats.finalText || "(timed out)";
	}

	// Hidden grader: lives in the task dir, runs against the sandbox repo.
	const graderPath = path.join(TASKS_DIR, task.id, task.grader);
	let gradeDetail: unknown = null;
	let graderExitCode: number | null = null;
	if (!agent.timedOut) {
		const graderRun = await spawnWithTimeout(process.execPath, [graderPath], {
			cwd: repoDir,
			timeoutMs: GRADER_TIMEOUT_MS,
		});
		graderExitCode = graderRun.exitCode;
		if (graderRun.stdout.trim()) {
			try {
				gradeDetail = JSON.parse(graderRun.stdout.trim());
			} catch {
				gradeDetail = graderRun.stdout.trim().slice(0, 2000);
			}
		}
		if (!graderRun.stderr.trim() && graderRun.exitCode !== 0) {
			gradeDetail = gradeDetail ?? graderRun.stderr.trim().slice(0, 2000);
		}
	}

	const result: RunResult = {
		runId,
		timestamp: nowIso(),
		model: `${spec.provider}/${spec.modelId}`,
		endpoint: opts.endpoint,
		taskId: task.id,
		taskTags: task.tags,
		runIndex,
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

	fs.writeFileSync(path.join(runDir, "result.json"), JSON.stringify(result, null, 2) + "\n");
	fs.appendFileSync(RESULTS_PATH, JSON.stringify(result) + "\n");
	return { result };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
	const { values } = parseArgs({
		options: {
			model: { type: "string" },
			runs: { type: "string", default: "1" },
			tasks: { type: "string", default: "all" },
			endpoint: { type: "string" },
			api: { type: "string", default: "openai-completions" },
			"api-key": { type: "string", default: "bench" },
			concurrency: { type: "string", default: "1" },
		},
		strict: true,
	});

	if (!values.model) {
		console.error("usage: tsx bench/runner.ts --model <provider>/<model-id> [--endpoint url] [--runs N] [--tasks id,id|all]");
		process.exit(2);
	}
	const spec = parseModelSpec(values.model);
	const runCount = Math.max(1, Number.parseInt(values.runs ?? "1", 10) || 1);
	const concurrency = Math.max(1, Number.parseInt(values.concurrency ?? "1", 10) || 1);

	let tasks = listTasks();
	if (values.tasks && values.tasks !== "all") {
		const wanted = new Set(values.tasks.split(",").map((t) => t.trim()));
		tasks = tasks.filter((t) => wanted.has(t.id));
	}
	if (tasks.length === 0) {
		console.error("no tasks matched");
		process.exit(2);
	}

	console.log(`A-Coder Bench: model=${values.model} tasks=${tasks.map((t) => t.id).join(",")} runs=${runCount}`);

	const jobList: Array<{ task: TaskConfig; runIndex: number }> = [];
	for (const task of tasks) {
		for (let i = 1; i <= runCount; i++) jobList.push({ task, runIndex: i });
	}

	let cursor = 0;
	const results: RunResult[] = [];
	async function worker(): Promise<void> {
		while (cursor < jobList.length) {
			const job = jobList[cursor++];
			process.stdout.write(`  [${job.task.id} r${job.runIndex}] running... `);
			const { result } = await runOnce(job.task, spec, job.runIndex, {
				endpoint: values.endpoint,
				apiKey: values["api-key"] ?? "bench",
				api: values.api ?? "openai-completions",
			});
			const icon = result.pass ? "PASS" : result.timedOut ? "TIMEOUT" : "FAIL";
			console.log(`${icon} (${Math.round(result.durationMs / 1000)}s, ${result.stats.usage.totalTokens} tok)`);
			results.push(result);
		}
	}
	await Promise.all(Array.from({ length: concurrency }, () => worker()));

	const passed = results.filter((r) => r.pass).length;
	console.log(`done: ${passed}/${results.length} passed`);
}

main().catch((err: unknown) => {
	console.error(err instanceof Error ? err.stack : String(err));
	process.exit(1);
});