import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	appendResult,
	BenchEventAccumulator,
	buildRunId,
	emptyRunStats,
	loadResults,
	parseBenchModelSpec,
	parseEventStream,
	resolveBenchScriptRuntime,
	writeEndpointAgentDir,
	writeIsolatedAgentDir,
} from "../src/bench/core.ts";
import { buildLeaderboard } from "../src/bench/report-core.ts";
import type { BenchRunResult } from "../src/bench/types.ts";

const tempDirs: string[] = [];

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "bench-core-"));
	tempDirs.push(dir);
	return dir;
}

function result(overrides: Partial<BenchRunResult> = {}): BenchRunResult {
	return {
		runId: "run-1",
		timestamp: "2026-01-01T00:00:00.000Z",
		model: "ollama-cloud/deepseek-v4.1-flash:1017",
		taskId: "001-fix-crash",
		taskTags: ["bugfix"],
		runIndex: 1,
		pass: true,
		timedOut: false,
		agentExitCode: 0,
		graderExitCode: 0,
		gradeDetail: { pass: true },
		durationMs: 1000,
		stats: {
			...emptyRunStats(),
			toolCalls: 2,
			toolErrors: 1,
			editFailures: 1,
			turns: 2,
			usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
			finalText: "done",
		},
		...overrides,
	};
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("A-Coder Bench core", () => {
	it("parses provider/model specs with colons and slashes", () => {
		expect(parseBenchModelSpec("ollama-cloud/deepseek-v4.1-flash:1017")).toEqual({
			provider: "ollama-cloud",
			modelId: "deepseek-v4.1-flash:1017",
		});
		expect(parseBenchModelSpec("openrouter/deepseek/deepseek-chat")).toEqual({
			provider: "openrouter",
			modelId: "deepseek/deepseek-chat",
		});
		expect(() => parseBenchModelSpec("deepseek-v4.1-flash:1017")).toThrow(/provider/);
	});

	it("builds filesystem-safe run ids", () => {
		const id = buildRunId(
			"ollama-cloud",
			"deepseek-v4.1-flash:1017",
			"001-fix-crash",
			2,
			new Date("2026-01-02T03:04:05.678Z"),
			"ab12cd",
		);
		expect(id).toBe("2026-01-02T03-04-05-678Z_ollama-cloud_deepseek-v4.1-flash_1017_001-fix-crash_r2_ab12cd");
		expect(id).not.toMatch(/[:/\\]/);
	});

	it("parses incremental events, direct turn usage, and edit failures", () => {
		const stdout = [
			JSON.stringify({ type: "turn_end", usage: { input: 10, output: 2, totalTokens: 12 } }),
			JSON.stringify({
				type: "turn_end",
				message: { usage: { input: 20, output: 3, totalTokens: 23 } },
			}),
			JSON.stringify({ type: "tool_execution_end", toolName: "edit", isError: true }),
			JSON.stringify({ type: "tool_execution_end", toolName: "bash", isError: false }),
			JSON.stringify({
				type: "agent_end",
				messages: [
					{ role: "assistant", content: [{ type: "text", text: "first" }] },
					{ role: "assistant", content: [{ type: "text", text: "final" }] },
				],
			}),
		].join("\n");

		const stats = parseEventStream(stdout);
		expect(stats.turns).toBe(2);
		expect(stats.usage).toEqual({ inputTokens: 30, outputTokens: 5, totalTokens: 35 });
		expect(stats.toolCalls).toBe(2);
		expect(stats.toolErrors).toBe(1);
		expect(stats.editFailures).toBe(1);
		expect(stats.finalText).toBe("final");
	});

	it("parses chunks split across NDJSON lines", () => {
		const accumulator = new BenchEventAccumulator();
		accumulator.push('{"type":"turn_end","usage":{"input":4,');
		accumulator.push('"output":1,"totalTokens":5}}\n{"type":"tool_execution_end"');
		accumulator.push(',"toolName":"write","isError":true}\n');
		accumulator.flush();
		expect(accumulator.stats.usage.totalTokens).toBe(5);
		expect(accumulator.stats.editFailures).toBe(1);
	});

	it("deduplicates results and ignores partial lines", () => {
		const dir = tempDir();
		appendResult(dir, result({ runId: "same", pass: false }));
		appendResult(dir, result({ runId: "same", pass: true }));
		appendResult(dir, result({ runId: "other", pass: false }));
		appendFileSync(join(dir, "results.jsonl"), '{"runId":"partial');

		const loaded = loadResults(dir);
		expect(loaded).toHaveLength(2);
		expect(loaded.find((entry) => entry.runId === "same")?.pass).toBe(true);
	});

	it("isolates MCP settings while linking ambient auth and models", () => {
		const previous = process.env.A_CODER_CLI_CODING_AGENT_DIR;
		const source = tempDir();
		const runDir = tempDir();
		mkdirSync(source, { recursive: true });
		writeFileSync(join(source, "settings.json"), JSON.stringify({ mcpServers: [{ name: "x" }] }));
		writeFileSync(join(source, "auth.json"), JSON.stringify({ ollama: { type: "api_key", key: "k" } }));
		writeFileSync(join(source, "models.json"), JSON.stringify({ providers: {} }));
		process.env.A_CODER_CLI_CODING_AGENT_DIR = source;
		try {
			const agentDir = writeIsolatedAgentDir(runDir);
			expect(JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"))).toEqual({
				mcpServers: [],
				memory: { enabled: false },
			});
			expect(existsSync(join(agentDir, "auth.json"))).toBe(true);
			expect(existsSync(join(agentDir, "models.json"))).toBe(true);
			expect(readFileSync(join(agentDir, "auth.json"), "utf8")).toContain("api_key");
		} finally {
			if (previous === undefined) delete process.env.A_CODER_CLI_CODING_AGENT_DIR;
			else process.env.A_CODER_CLI_CODING_AGENT_DIR = previous;
		}
	});

	it("does not write endpoint models through the linked user config", () => {
		const previous = process.env.A_CODER_CLI_CODING_AGENT_DIR;
		const source = tempDir();
		const runDir = tempDir();
		mkdirSync(source, { recursive: true });
		writeFileSync(join(source, "auth.json"), "{}");
		writeFileSync(join(source, "models.json"), JSON.stringify({ providers: { mine: {} } }));
		process.env.A_CODER_CLI_CODING_AGENT_DIR = source;
		try {
			writeIsolatedAgentDir(runDir, false);
			writeEndpointAgentDir(
				runDir,
				{ provider: "bench", modelId: "m" },
				"http://localhost:1234/v1",
				"k",
				"openai-completions",
			);
			expect(readFileSync(join(source, "models.json"), "utf8")).toContain("mine");
			expect(readFileSync(join(runDir, "agent", "models.json"), "utf8")).toContain("http://localhost:1234/v1");
		} finally {
			if (previous === undefined) delete process.env.A_CODER_CLI_CODING_AGENT_DIR;
			else process.env.A_CODER_CLI_CODING_AGENT_DIR = previous;
		}
	});

	it("uses a script runtime rather than the CLI binary for graders", () => {
		expect(resolveBenchScriptRuntime().command).toBe(process.execPath);
		// A compiled Bun binary's execPath is the CLI, so the compiled path must
		// resolve a real JS runtime instead of re-running the agent on grade.mjs.
		expect(["node", "node.exe", "bun", "bun.exe"]).toContain(basename(resolveBenchScriptRuntime(true).command));
	});

	it("separates endpoints and reports timeouts in the leaderboard", () => {
		const report = buildLeaderboard([
			result({ runId: "a", endpoint: "http://localhost:1234/v1" }),
			result({ runId: "b", timedOut: true, pass: false, durationMs: 5000 }),
			result({ runId: "c", endpoint: "http://localhost:1234/v1", pass: false }),
		]);
		expect(report).toContain("ollama-cloud/deepseek-v4.1-flash:1017 @ http://localhost:1234/v1");
		expect(report).toContain("timeouts");
		expect(report).toContain("| 1 |");
	});
});
