/**
 * A-Coder Bench report generation: aggregate run results into a markdown
 * leaderboard (pass@1, pass@any, token cost, tool/edit-failure rates).
 */

import type { BenchRunResult } from "./types.ts";

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

function aggregateByTask(results: BenchRunResult[]): Map<string, TaskAgg> {
	const byKey = new Map<string, BenchRunResult[]>();
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
		out.set(key, {
			taskId: key.split("||")[1] ?? "?",
			runs: runs.length,
			passes: runs.filter((r) => r.pass).length,
			anyPass: runs.some((r) => r.pass),
			avgDurationMs: runs.reduce((s, r) => s + r.durationMs, 0) / runs.length,
			avgTokens: runs.reduce((s, r) => s + r.stats.usage.totalTokens, 0) / runs.length,
			avgTurns: runs.reduce((s, r) => s + r.stats.turns, 0) / runs.length,
			toolErrorRate: totalToolCalls > 0 ? totalToolErrors / totalToolCalls : 0,
			editFailures: runs.reduce((s, r) => s + r.stats.editFailures, 0),
		});
	}
	return out;
}

function fmtPct(n: number): string {
	return `${Math.round(n * 100)}%`;
}

function fmtMs(ms: number): string {
	return ms >= 60_000 ? `${(ms / 60_000).toFixed(1)}m` : `${Math.round(ms / 1000)}s`;
}

export function buildLeaderboard(results: BenchRunResult[]): string {
	const byTask = aggregateByTask(results);
	const models = [...new Set(results.map((r) => r.model))].sort();
	const taskIds = [...new Set(results.map((r) => r.taskId))].sort();

	const lines: string[] = [];
	lines.push("# A-Coder Bench — Leaderboard");
	lines.push("");
	lines.push(
		`Generated ${new Date().toISOString()} · ${results.length} runs · ${models.length} model(s) · ${taskIds.length} task(s)`,
	);
	lines.push("");

	// Model summary
	lines.push("## Models");
	lines.push("");
	lines.push("| model | pass@1 | pass@any | runs | avg tokens | avg turns | tool err | edit fails |");
	lines.push("|---|---|---|---|---|---|---|---|");
	for (const model of models) {
		const modelResults = results.filter((r) => r.model === model);
		const aggs = [...aggregateByTask(modelResults).values()];
		const pass1 = aggs.reduce((s, a) => s + a.passes / a.runs, 0) / aggs.length;
		const passAny = aggs.filter((a) => a.anyPass).length / aggs.length;
		const avgTokens = modelResults.reduce((s, r) => s + r.stats.usage.totalTokens, 0) / modelResults.length;
		const avgTurns = modelResults.reduce((s, r) => s + r.stats.turns, 0) / modelResults.length;
		const toolCalls = modelResults.reduce((s, r) => s + r.stats.toolCalls, 0);
		const toolErrors = modelResults.reduce((s, r) => s + r.stats.toolErrors, 0);
		const editFails = modelResults.reduce((s, r) => s + r.stats.editFailures, 0);
		lines.push(
			`| ${model} | ${fmtPct(pass1)} | ${fmtPct(passAny)} | ${modelResults.length} | ${Math.round(avgTokens)} | ${avgTurns.toFixed(1)} | ${
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
