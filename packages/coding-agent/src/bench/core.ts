/**
 * A-Coder Bench core: task discovery, run execution, grading, recording.
 *
 * Shared by the standalone `bench/runner.ts` script, the headless
 * `a-coder-cli bench run` mode, and the interactive TUI. Execution model:
 * each run spawns this same CLI headless (`--mode json`) in a fresh copy of
 * the task repo, enforces the task timeout, then runs the hidden grader from
 * the task directory against the sandbox (the grader is never visible to the
 * agent).
 */

import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs, { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { getAgentDir } from "../config.ts";
import { STARTER_TASK_FILES } from "./starter-tasks.generated.ts";
import type {
	BenchChildCommand,
	BenchQueueOptions,
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

/** Cap captured stdout/stderr for grader/crash diagnostics. */
const MAX_CAPTURE_CHARS = 4 * 1024 * 1024;

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
	fs.mkdirSync(benchDir, { recursive: true });
	fs.appendFileSync(resultsPath(benchDir), `${JSON.stringify(result)}\n`);
}

/**
 * Load results, ignoring partially-written trailing lines and de-duplicating
 * by runId (older runner versions appended the same run twice).
 */
export function loadResults(benchDir: string): BenchRunResult[] {
	const path = resultsPath(benchDir);
	if (!existsSync(path)) return [];
	const byRunId = new Map<string, BenchRunResult>();
	for (const line of fs.readFileSync(path, "utf8").split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("{")) continue;
		try {
			const result = JSON.parse(trimmed) as BenchRunResult;
			const key = result.runId || `${result.model}||${result.taskId}||${result.runIndex}`;
			byRunId.set(key, result);
		} catch {
			// A concurrent writer may have left a partial line; skip it.
		}
	}
	return [...byRunId.values()];
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

function linkOrCopy(source: string, target: string): void {
	if (!existsSync(source)) return;
	try {
		fs.symlinkSync(source, target, "file");
	} catch {
		fs.copyFileSync(source, target);
	}
}

/**
 * Build an isolated agent dir for one run. The real auth/models files are
 * linked in (so ambient providers keep working), while settings are reduced to
 * an explicit empty MCP list. Without this, every run inherits the user's MCP
 * servers, packages, and settings, which changes both prompt size and startup
 * latency.
 */
export function writeIsolatedAgentDir(runDir: string, linkModels = true): string {
	const agentDir = join(runDir, "agent");
	fs.mkdirSync(agentDir, { recursive: true });
	fs.writeFileSync(
		join(agentDir, "settings.json"),
		`${JSON.stringify({ mcpServers: [], memory: { enabled: false } }, null, 2)}\n`,
	);
	const sourceDir = getAgentDir();
	linkOrCopy(join(sourceDir, "auth.json"), join(agentDir, "auth.json"));
	// Never link models.json for an endpoint run: writing the generated file
	// through a symlink would overwrite the user's real config.
	if (linkModels) linkOrCopy(join(sourceDir, "models.json"), join(agentDir, "models.json"));
	return agentDir;
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

/** Find a JS runtime that can execute a plain `.mjs` grader. */
function findOnPath(name: string): string | undefined {
	const path = process.env.PATH ?? "";
	for (const dir of path.split(delimiter)) {
		if (!dir) continue;
		const direct = join(dir, name);
		if (existsSync(direct)) return direct;
		if (process.platform === "win32") {
			const exts = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").filter(Boolean);
			for (const ext of exts) {
				const candidate = join(dir, `${name}${ext.toLowerCase()}`);
				if (existsSync(candidate)) return candidate;
			}
		}
	}
	return undefined;
}

/** Common install locations for GUI-launched apps with a minimal PATH. */
function runtimeFallbackDirs(): string[] {
	const home = homedir();
	const dirs = [
		process.env.A_CODER_CLI_NODE_DIR,
		join(home, ".bun", "bin"),
		join(home, ".volta", "bin"),
		join(home, ".asdf", "shims"),
		join(home, ".local", "bin"),
		"/opt/homebrew/bin",
		"/usr/local/bin",
		"/usr/bin",
	].filter((dir): dir is string => Boolean(dir));
	const versionRoots = [join(home, ".nvm", "versions", "node"), join(home, ".local", "share", "fnm", "node-versions")];
	for (const root of versionRoots) {
		try {
			const versions = fs
				.readdirSync(root)
				.filter((name) => !name.startsWith("."))
				.sort()
				.reverse();
			for (const version of versions) {
				dirs.push(join(root, version, "installation", "bin"));
				dirs.push(join(root, version, "bin"));
			}
		} catch {
			// runtime manager not installed
		}
	}
	return dirs;
}

function findRuntime(name: string): string | undefined {
	const fromPath = findOnPath(name);
	if (fromPath) return fromPath;
	for (const dir of runtimeFallbackDirs()) {
		const candidate = join(dir, name);
		if (existsSync(candidate)) return candidate;
	}
	return undefined;
}

/**
 * Resolve the runtime used to execute task graders. A compiled Bun binary's
 * `process.execPath` is the CLI itself, not Node, so `process.execPath
 * grade.mjs` would accidentally boot another agent instead of the grader.
 * Prefer Node (the graders are Node ESM), then Bun.
 */
export function resolveBenchScriptRuntime(compiledBunBinary: boolean = isBunBinary): BenchChildCommand {
	if (!compiledBunBinary) return { command: process.execPath, baseArgs: [] };
	const node = findRuntime(process.platform === "win32" ? "node.exe" : "node");
	if (node) return { command: node, baseArgs: [] };
	const bun = findRuntime(process.platform === "win32" ? "bun.exe" : "bun");
	if (bun) return { command: bun, baseArgs: [] };
	throw new Error(
		"A JavaScript runtime (node or bun) is required to run bench graders. Install Node.js or set A_CODER_CLI_NODE_DIR.",
	);
}

// ---------------------------------------------------------------------------
// Run IDs
// ---------------------------------------------------------------------------

function runIdPart(value: string): string {
	const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^_+|_+$/g, "");
	return (cleaned || "run").slice(0, 80);
}

/** Build a filesystem-safe run id; model ids may contain `/` and `:`. */
export function buildRunId(
	provider: string,
	modelId: string,
	taskId: string,
	runIndex: number,
	now: Date = new Date(),
	suffix: string = randomBytes(3).toString("hex"),
): string {
	const stamp = now.toISOString().replace(/[:.]/g, "-");
	return `${stamp}_${runIdPart(provider)}_${runIdPart(modelId)}_${runIdPart(taskId)}_r${runIndex}_${runIdPart(suffix)}`;
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
	const input = typeof u.input === "number" ? u.input : 0;
	const output = typeof u.output === "number" ? u.output : 0;
	const total = typeof u.totalTokens === "number" ? u.totalTokens : input + output;
	return { input, output, total };
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

function consumeEvent(event: AgentEventLike, stats: BenchRunStats): void {
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
			// Current agent events expose usage on turn_end; older streams only
			// carried it on the turn's assistant message.
			const message = event.message as { usage?: unknown } | undefined;
			const turnUsage = asUsage(event.usage ?? message?.usage);
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

/**
 * Incremental NDJSON parser. Feed stdout chunks as they arrive and flush at
 * EOF; this keeps bench memory bounded for long runs with large tool output.
 */
export class BenchEventAccumulator {
	readonly stats = emptyRunStats();
	private pending = "";

	push(chunk: string): void {
		this.pending += chunk;
		let start = 0;
		for (;;) {
			const newline = this.pending.indexOf("\n", start);
			if (newline === -1) break;
			this.consumeLine(this.pending.slice(start, newline));
			start = newline + 1;
		}
		this.pending = this.pending.slice(start);
	}

	flush(): void {
		if (this.pending.trim()) this.consumeLine(this.pending);
		this.pending = "";
	}

	private consumeLine(line: string): void {
		const trimmed = line.trim();
		if (!trimmed.startsWith("{")) return;
		try {
			consumeEvent(JSON.parse(trimmed) as AgentEventLike, this.stats);
		} catch {
			// Ignore malformed event lines; the raw events file still has them.
		}
	}
}

export function parseEventStream(stdout: string): BenchRunStats {
	const accumulator = new BenchEventAccumulator();
	accumulator.push(stdout);
	accumulator.flush();
	return accumulator.stats;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

function appendCaptured(current: string, chunk: string): string {
	if (current.length >= MAX_CAPTURE_CHARS) return current;
	return current + chunk.slice(0, MAX_CAPTURE_CHARS - current.length);
}

/** Kill the child and, on POSIX, its whole process group. */
function killTree(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
	if (child.pid === undefined) return;
	if (process.platform === "win32") {
		spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
		return;
	}
	try {
		process.kill(-child.pid, signal);
	} catch {
		try {
			child.kill(signal);
		} catch {
			// already gone
		}
	}
}

function spawnWithTimeout(
	cmd: string,
	args: string[],
	opts: {
		cwd: string;
		env?: NodeJS.ProcessEnv;
		timeoutMs: number;
		onStdout?: (chunk: string) => void;
	},
): Promise<SpawnOutcome> {
	return new Promise((resolve) => {
		const child = spawn(cmd, args, {
			cwd: opts.cwd,
			env: opts.env ?? process.env,
			stdio: ["ignore", "pipe", "pipe"],
			detached: process.platform !== "win32",
		});
		let stdout = "";
		let stderr = "";
		let timedOut = false;
		let settled = false;
		let forceTimer: NodeJS.Timeout | undefined;
		child.stdout?.setEncoding("utf8");
		child.stderr?.setEncoding("utf8");
		child.stdout?.on("data", (chunk: string) => {
			if (opts.onStdout) opts.onStdout(chunk);
			else stdout = appendCaptured(stdout, chunk);
		});
		child.stderr?.on("data", (chunk: string) => {
			stderr = appendCaptured(stderr, chunk);
		});

		const finish = (exitCode: number | null): void => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			if (forceTimer) clearTimeout(forceTimer);
			resolve({ stdout, stderr, exitCode, timedOut });
		};

		const timer = setTimeout(() => {
			timedOut = true;
			killTree(child, "SIGTERM");
			forceTimer = setTimeout(() => killTree(child, "SIGKILL"), KILL_GRACE_MS);
		}, opts.timeoutMs);

		child.on("error", (error: Error) => {
			stderr = appendCaptured(stderr, `\n${error.message}`);
			finish(null);
		});
		child.on("close", (code) => finish(code));
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

function validateTask(benchDir: string, task: BenchTask): { repoDir: string; graderPath: string } {
	const taskDir = join(tasksDir(benchDir), task.id);
	const repoDir = join(taskDir, "repo");
	const graderPath = join(taskDir, task.grader);
	if (!existsSync(repoDir)) throw new Error(`task ${task.id}: missing repo/`);
	if (!existsSync(graderPath)) throw new Error(`task ${task.id}: missing grader ${task.grader}`);
	return { repoDir, graderPath };
}

/** Run one (task x run) combination and record the result. */
export async function runTaskOnce(options: RunTaskOptions): Promise<BenchRunResult> {
	const { benchDir, task, provider, modelId } = options;
	const { repoDir: sourceRepo, graderPath } = validateTask(benchDir, task);
	const runId = buildRunId(provider, modelId, task.id, options.runIndex);
	const runDir = join(benchDir, "runs", runId);
	const repoDir = join(runDir, "repo");
	fs.mkdirSync(runDir, { recursive: true });
	fs.cpSync(sourceRepo, repoDir, { recursive: true });

	const env: NodeJS.ProcessEnv = { ...process.env };
	const agentDir = writeIsolatedAgentDir(runDir, !options.endpoint);
	if (options.endpoint) {
		writeEndpointAgentDir(runDir, { provider, modelId }, options.endpoint, options.apiKey, options.api);
	}
	env.A_CODER_CLI_CODING_AGENT_DIR = agentDir;

	// Keep the harness itself out of the measurement: user extensions, skills,
	// prompt templates, themes, project-local config, and repo context files
	// stay disabled; settings.json in the isolated agent dir also drops MCP
	// servers and memory injection.
	const args = [
		...options.child.baseArgs,
		"--mode",
		"json",
		"--no-session",
		"--permission-mode",
		"allow",
		"--no-extensions",
		"--no-skills",
		"--no-prompt-templates",
		"--no-themes",
		"--no-context-files",
		"--no-approve",
		"--provider",
		provider,
		"--model",
		modelId,
		"-p",
		task.instruction,
	];
	const eventsPath = join(runDir, "events.jsonl");
	const eventStream = fs.createWriteStream(eventsPath, { flags: "w" });
	eventStream.on("error", () => {
		// Missing events are non-fatal; result.json still records the outcome.
	});
	const accumulator = new BenchEventAccumulator();

	const startedAt = Date.now();
	const agent = await spawnWithTimeout(options.child.command, args, {
		cwd: repoDir,
		env,
		timeoutMs: task.timeoutSeconds * 1000,
		onStdout: (chunk) => {
			accumulator.push(chunk);
			eventStream.write(chunk);
		},
	});
	accumulator.flush();
	await new Promise<void>((resolve) => {
		eventStream.once("error", () => resolve());
		eventStream.end(resolve);
	});
	const durationMs = Date.now() - startedAt;
	const stats = accumulator.stats;

	// Hidden grader: lives in the task dir, runs against the sandbox repo.
	let gradeDetail: unknown = null;
	let graderExitCode: number | null = null;
	let graderTimedOut = false;
	if (!agent.timedOut) {
		let graderRun: SpawnOutcome | undefined;
		try {
			const runtime = resolveBenchScriptRuntime();
			graderRun = await spawnWithTimeout(runtime.command, [...runtime.baseArgs, graderPath], {
				cwd: repoDir,
				timeoutMs: GRADER_TIMEOUT_MS,
			});
			graderTimedOut = graderRun.timedOut;
			graderExitCode = graderRun.exitCode;
			gradeDetail = graderTimedOut
				? `grader timed out after ${GRADER_TIMEOUT_MS}ms`
				: (parseGradeDetail(graderRun.stdout) ??
					(graderRun.exitCode !== 0 ? graderRun.stderr.trim().slice(0, 2000) : null));
		} catch (error) {
			gradeDetail = error instanceof Error ? error.message : String(error);
		}
	}

	const result: BenchRunResult = {
		runId,
		timestamp: new Date().toISOString(),
		model: `${provider}/${modelId}`,
		endpoint: options.endpoint,
		taskId: task.id,
		taskTags: task.tags,
		runIndex: options.runIndex,
		pass: !agent.timedOut && !graderTimedOut && graderExitCode === 0,
		timedOut: agent.timedOut,
		graderTimedOut,
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

function errorResult(options: RunTaskOptions, error: unknown): BenchRunResult {
	const result: BenchRunResult = {
		runId: buildRunId(options.provider, options.modelId, options.task.id, options.runIndex),
		timestamp: new Date().toISOString(),
		model: `${options.provider}/${options.modelId}`,
		endpoint: options.endpoint,
		taskId: options.task.id,
		taskTags: options.task.tags,
		runIndex: options.runIndex,
		pass: false,
		timedOut: false,
		graderTimedOut: false,
		agentExitCode: null,
		graderExitCode: null,
		gradeDetail: null,
		durationMs: 0,
		stats: emptyRunStats(),
		error: error instanceof Error ? error.message : String(error),
	};
	try {
		const runDir = join(options.benchDir, "runs", result.runId);
		fs.mkdirSync(runDir, { recursive: true });
		fs.writeFileSync(join(runDir, "result.json"), `${JSON.stringify(result, null, 2)}\n`);
	} catch {
		// best-effort artifact; results.jsonl still records the failure
	}
	return result;
}

/**
 * Run a job list with bounded concurrency. Concurrency is opt-in (default 1)
 * because many hosted providers rate-limit parallel long-context runs.
 */
export async function runBenchQueue(options: BenchQueueOptions): Promise<BenchRunResult[]> {
	const concurrency = Math.max(1, Math.min(options.concurrency ?? 1, options.jobs.length || 1));
	const results: Array<BenchRunResult | undefined> = new Array(options.jobs.length);
	let cursor = 0;

	const worker = async (): Promise<void> => {
		for (;;) {
			const index = cursor++;
			const job = options.jobs[index];
			if (!job) return;
			options.onStart?.(job, index);
			let result: BenchRunResult;
			try {
				result = await runTaskOnce({
					benchDir: options.benchDir,
					task: job.task,
					provider: options.provider,
					modelId: options.modelId,
					runIndex: job.runIndex,
					endpoint: options.endpoint,
					apiKey: options.apiKey,
					api: options.api,
					child: options.child,
				});
			} catch (error) {
				result = errorResult(
					{
						benchDir: options.benchDir,
						task: job.task,
						provider: options.provider,
						modelId: options.modelId,
						runIndex: job.runIndex,
						endpoint: options.endpoint,
						apiKey: options.apiKey,
						api: options.api,
						child: options.child,
					},
					error,
				);
				appendResult(options.benchDir, result);
			}
			results[index] = result;
			options.onResult?.(job, result, index);
		}
	};

	await Promise.all(Array.from({ length: concurrency }, worker));
	return results.filter((result): result is BenchRunResult => Boolean(result));
}

export type { BenchQueueJob, BenchQueueOptions } from "./types.ts";
