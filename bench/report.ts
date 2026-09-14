/**
 * A-Coder Bench report generator.
 *
 * Reads bench/results.jsonl and writes bench/leaderboard.md with per-model
 * task pass rates, pass@any (at least one success across the recorded runs),
 * token cost, and tool/edit-failure rates.
 *
 *   node_modules/.bin/tsx bench/report.ts
 */

import fs from "node:fs";
import path from "node:path";

const BENCH_DIR = path.resolve(import.meta.dirname);
const RESULTS_PATH = path.join(BENCH_DIR, "results.jsonl");
const LEADERBOARD_PATH = path.join(BENCH_DIR, "leaderboard.md");

interface RunUsage {
	inputTokens: number;
	outputTokens: number;
	totalTokens: number;
}

interface RunResult {
	runId: string;
	timestamp: string;
	model: string;
	taskId: string;
	taskTags: string[];
	runIndex: number;
	pass: boolean;
	timedOut: boolean;
	durationMs: number;
	stats: {
		toolCalls: number;
		toolErrors: number;
		editFailures: number;
		turns: number;
		usage: RunUsage;
	};
}

function loadResults(): RunResult[] {
	if (!fs.existsSync(RESULTS_PATH)) return [];
	return fs
		.readFileSync(RESULTS_PATH, "utf8")
		.split("\n")
		.filter((line) => line.trim().startsWith("{"))
		.map((line) => JSON.parse(line) as RunResult);
}

interface TaskAgg {
	taskId: string;
	runs: number;
	passes: number;
	anyPass: boolean;
	avgDurationMs: number;
	avgTokens: number;
	avgTurns: number;
	toolErrorRate: number;
	editFailures: number;
}

function aggregateByTask(results: RunResult[]): Map<string, TaskAgg> {
	const byKey = new Map<string, RunResult[]>();
	for (const r of results) {
		const key = `${r.model}||${r.taskId}`;
		const list = byKey.get(key);
		if (list) list.push(r);
		else byKey.set(key, [r]);
	}
	const out = new Map<string, TaskAgg>();
	for (const [key, runs] of byKey) {
		const totalToolCalls = runs.reduce((sum, r) => sum + r.stats.toolCalls, 0);
		const totalToolErrors = runs.reduce((sum, r) => sum + r.stats.toolErrors, 0);
		const agg: TaskAgg = {
			taskId: key.split("||")[1] ?? "?",
			runs: runs.length,
			passes: runs.filter((r) => r.pass).length,
			anyPass: runs.some((r) => r.pass),
			avgDurationMs: runs.reduce((s, r) => s + r.durationMs, 0) / runs.length,
			avgTokens: runs.reduce((s, r) => s + r.stats.usage.totalTokens, 0) / runs.length,
			avgTurns: runs.reduce((s, r) => s + r.stats.turns, 0) / runs.length,
			toolErrorRate: totalToolCalls > 0 ? totalToolErrors / totalToolCalls : 0,
			editFailures: runs.reduce((s, r) => s + r.stats.editFailures, 0),
		};
		out.set(key, agg);
	}
	return out;
}

function fmtPct(n: number): string {
	return `${Math.round(n * 100)}%`;
}

function fmtMs(ms: number): string {
	return ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}m` : `${Math.round(ms / 1000)}s`;
}

function buildLeaderboard(results: RunResult[]): string {
	const byTask = aggregateByTask(results);
	const models = [...new Set(results.map((r) => r.model))].sort();
	const taskIds = [...new Set(results.map((r) => r.taskId))].sort();

	const lines: string[] = [];
	lines.push("# A-Coder Bench — Leaderboard");
	lines.push("");
	lines.push(`Generated ${new Date().toISOString()} · ${results.length} runs · ${models.length} model(s) · ${taskIds.length} task(s)`);
	lines.push("");

	// Model summary
	lines.push("## Models");
	lines.push("");
	lines.push("| model | pass@1 | pass@any | runs | avg tokens | avg turns | tool err | edit fails |");
	lines.push("|---|---|---|---|---|---|---|---|");
	for (const model of models) {
		const runs = results.filter((r) => r.model === model);
		const agg = aggregateByTask(runs);
		const values = [...agg.values()];
		const pass1 = values.reduce((s, a) => s + a.passes / a.runs, 0) / values.length;
		const passAny = values.filter((a) => a.anyPass).length / values.length;
		const avgTokens = runs.reduce((s, r) => s + r.stats.usage.totalTokens, 0) / runs.length;
		const avgTurns = runs.reduce((s, r) => s + r.stats.turns, 0) / runs.length;
		const toolCalls = runs.reduce((s, r) => s + r.stats.toolCalls, 0);
		const toolErrors = runs.reduce((s, r) => s + r.stats.toolErrors, 0);
		const editFails = runs.reduce((s, r) => s + r.stats.editFailures, 0);
		lines.push(
			`| ${model} | ${fmtPct(pass1)} | ${fmtPct(passAny)} | ${runs.length} | ${Math.round(avgTokens)} | ${avgTurns.toFixed(1)} | ${
				toolCalls > 0 ? fmtPct(toolErrors / toolCalls) : "-"
			} | ${editFails} |`,
		);
	}
	lines.push("");

	// Per-task detail
	for (const model of models) {
		lines.push(`## ${model}`);
		lines.push("");
		lines.push("| task | pass | pass@any | avg time | avg tokens | avg turns | tool err | edit fails |");
		lines.push("|---|---|---|---|---|---|---|---|");
		for (const taskId of taskIds) {
			const agg = byTask.get(`${model}||${taskId}`);
			if (!agg) continue;
			lines.push(
				`| ${taskId} | ${agg.passes}/${agg.runs} | ${agg.anyPass ? "yes" : "no"} | ${fmtMs(agg.avgDurationMs)} | ${Math.round(
					agg.avgTokens,
				)} | ${agg.avgTurns.toFixed(1)} | ${fmtPct(agg.toolErrorRate)} | ${agg.editFailures} |`,
			);
		}
		lines.push("");
	}

	return lines.join("\n");
}

function main(): void {
	const results = loadResults();
	if (results.length === 0) {
		console.error("no results yet - run bench/runner.ts first");
		process.exit(1);
	}
	const md = buildLeaderboard(results);
	fs.writeFileSync(LEADERBOARD_PATH, md + "\n");
	process.stdout.write(md);
	console.log(`\nwrote ${path.relative(process.cwd(), LEADERBOARD_PATH)}`);
}

main();