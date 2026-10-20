/**
 * A-Coder Bench report generation: aggregate run results into a markdown
 * leaderboard (pass@1, pass@any, wall time, token usage, tool/edit failures,
 * timeouts, and agent errors).
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
	timeouts: number;
	agentErrors: number;
}

/** Endpoint-qualified label: two endpoints for one model are different runs. */
function resultLabel(result: BenchRunResult): string {
	return result.endpoint ? `${result.model} @ ${result.endpoint}` : result.model;
}

function aggregateByTask(results: BenchRunResult[]): Map<string, TaskAgg> {
	const byKey = new Map<string, BenchRunResult[]>();
	for (const result of results) {
		const key = `${resultLabel(result)}||${result.taskId}`;
		const list = byKey.get(key);
		if (list) list.push(result);
		else byKey.set(key, [result]);
	}
	const out = new Map<string, TaskAgg>();
	for (const [key, runs] of byKey) {
		const totalToolCalls = runs.reduce((sum, result) => sum + result.stats.toolCalls, 0);
		const totalToolErrors = runs.reduce((sum, result) => sum + result.stats.toolErrors, 0);
		out.set(key, {
			taskId: key.split("||")[1] ?? "?",
			runs: runs.length,
			passes: runs.filter((result) => result.pass).length,
			anyPass: runs.some((result) => result.pass),
			avgDurationMs: runs.reduce((sum, result) => sum + result.durationMs, 0) / runs.length,
			avgTokens: runs.reduce((sum, result) => sum + result.stats.usage.totalTokens, 0) / runs.length,
			avgTurns: runs.reduce((sum, result) => sum + result.stats.turns, 0) / runs.length,
			toolErrorRate: totalToolCalls > 0 ? totalToolErrors / totalToolCalls : 0,
			editFailures: runs.reduce((sum, result) => sum + result.stats.editFailures, 0),
			timeouts: runs.filter((result) => result.timedOut || result.graderTimedOut).length,
			agentErrors: runs.filter((result) => Boolean(result.error) && !result.timedOut).length,
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
	const models = [...new Set(results.map(resultLabel))].sort();
	const taskIds = [...new Set(results.map((result) => result.taskId))].sort();

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
	lines.push(
		"| model | pass@1 | pass@any | runs | avg time | avg tokens | avg turns | tool err | edit fails | timeouts | agent err |",
	);
	lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
	for (const model of models) {
		const modelResults = results.filter((result) => resultLabel(result) === model);
		const aggs = [...aggregateByTask(modelResults).values()];
		const pass1 = aggs.reduce((sum, agg) => sum + agg.passes / agg.runs, 0) / aggs.length;
		const passAny = aggs.filter((agg) => agg.anyPass).length / aggs.length;
		const avgTokens =
			modelResults.reduce((sum, result) => sum + result.stats.usage.totalTokens, 0) / modelResults.length;
		const avgTurns = modelResults.reduce((sum, result) => sum + result.stats.turns, 0) / modelResults.length;
		const avgDuration = modelResults.reduce((sum, result) => sum + result.durationMs, 0) / modelResults.length;
		const toolCalls = modelResults.reduce((sum, result) => sum + result.stats.toolCalls, 0);
		const toolErrors = modelResults.reduce((sum, result) => sum + result.stats.toolErrors, 0);
		const editFails = modelResults.reduce((sum, result) => sum + result.stats.editFailures, 0);
		const timeouts = modelResults.filter((result) => result.timedOut || result.graderTimedOut).length;
		const agentErrors = modelResults.filter((result) => Boolean(result.error) && !result.timedOut).length;
		lines.push(
			`| ${model} | ${fmtPct(pass1)} | ${fmtPct(passAny)} | ${modelResults.length} | ${fmtMs(avgDuration)} | ${Math.round(
				avgTokens,
			)} | ${avgTurns.toFixed(1)} | ${toolCalls > 0 ? fmtPct(toolErrors / toolCalls) : "-"} | ${editFails} | ${timeouts} | ${agentErrors} |`,
		);
	}
	lines.push("");

	// Per-task detail
	for (const model of models) {
		lines.push(`## ${model}`);
		lines.push("");
		lines.push(
			"| task | pass | pass@any | avg time | avg tokens | avg turns | tool err | edit fails | timeouts | agent err |",
		);
		lines.push("|---|---|---|---|---|---|---|---|---|---|");
		for (const taskId of taskIds) {
			const agg = byTask.get(`${model}||${taskId}`);
			if (!agg) continue;
			lines.push(
				`| ${taskId} | ${agg.passes}/${agg.runs} | ${agg.anyPass ? "yes" : "no"} | ${fmtMs(agg.avgDurationMs)} | ${Math.round(
					agg.avgTokens,
				)} | ${agg.avgTurns.toFixed(1)} | ${fmtPct(agg.toolErrorRate)} | ${agg.editFailures} | ${agg.timeouts} | ${agg.agentErrors} |`,
			);
		}
		lines.push("");
	}

	return lines.join("\n");
}
