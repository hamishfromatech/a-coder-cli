/**
 * A-Coder Bench runner (standalone script).
 *
 * Runs (model x task x run) combinations against the a-coder-cli agent loop.
 * Thin CLI wrapper over the shared bench core in
 * packages/coding-agent/src/bench/ - see that module for the execution model,
 * and bench/README.md for usage.
 *
 * Run with the repo's tsx:
 *   node_modules/.bin/tsx bench/runner.ts --model ollama/gemma3:1b
 */

import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { appendResult, findBenchDir, loadTasks, parseBenchModelSpec, resolveBenchChildCommand, runTaskOnce } from "../packages/coding-agent/src/bench/core.ts";
import type { BenchRunResult } from "../packages/coding-agent/src/bench/types.ts";

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
	const benchDir = findBenchDir();
	if (!benchDir) {
		console.error("no bench/tasks found - run from an a-coder-cli repository checkout");
		process.exit(2);
	}
	const spec = parseBenchModelSpec(values.model);
	const runCount = Math.max(1, Number.parseInt(values.runs ?? "1", 10) || 1);
	const concurrency = Math.max(1, Number.parseInt(values.concurrency ?? "1", 10) || 1);

	let tasks = loadTasks(benchDir);
	if (values.tasks && values.tasks !== "all") {
		const wanted = new Set(values.tasks.split(",").map((t) => t.trim()));
		tasks = tasks.filter((t) => wanted.has(t.id));
	}
	if (tasks.length === 0) {
		console.error("no tasks matched");
		process.exit(2);
	}

	console.log(`A-Coder Bench: model=${values.model} tasks=${tasks.map((t) => t.id).join(",")} runs=${runCount}`);
	const child = resolveBenchChildCommand();

	const jobList: Array<{ taskId: string; runIndex: number }> = [];
	for (const task of tasks) {
		for (let i = 1; i <= runCount; i++) jobList.push({ taskId: task.id, runIndex: i });
	}

	let cursor = 0;
	const results: BenchRunResult[] = [];
	async function worker(): Promise<void> {
		while (cursor < jobList.length) {
			const job = jobList[cursor++];
			const task = tasks.find((t) => t.id === job.taskId);
			if (!task) continue;
			process.stdout.write(`  [${task.id} r${job.runIndex}] running... `);
			const result = await runTaskOnce({
				benchDir,
				task,
				provider: spec.provider,
				modelId: spec.modelId,
				runIndex: job.runIndex,
				endpoint: values.endpoint,
				apiKey: values["api-key"] ?? "bench",
				api: values.api ?? "openai-completions",
				child,
			});
			appendResult(benchDir, result);
			const icon = result.pass ? "PASS" : result.timedOut ? "TIMEOUT" : "FAIL";
			console.log(`${icon} (${Math.round(result.durationMs / 1000)}s, ${result.stats.usage.totalTokens} tok)`);
			results.push(result);
		}
	}
	await Promise.all(Array.from({ length: concurrency }, () => worker()));

	const passed = results.filter((r) => r.pass).length;
	console.log(`done: ${passed}/${results.length} passed`);
	console.log(`leaderboard: ${path.join(path.relative(process.cwd(), benchDir), "..", "leaderboard.md")} (run tsx bench/report.ts)`);
}

main().catch((err: unknown) => {
	console.error(err instanceof Error ? err.stack : String(err));
	process.exit(1);
});