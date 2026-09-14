/**
 * A-Coder Bench report generator (standalone script).
 *
 * Reads bench/results.jsonl and writes bench/leaderboard.md. Thin wrapper
 * over buildLeaderboard in packages/coding-agent/src/bench/report-core.ts.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { findBenchDir, loadResults } from "../packages/coding-agent/src/bench/core.ts";
import { buildLeaderboard } from "../packages/coding-agent/src/bench/report-core.ts";

function main(): void {
	const benchDir = findBenchDir();
	if (!benchDir) {
		console.error("no bench/tasks found - run from an a-coder-cli repository checkout");
		process.exit(1);
	}
	const results = loadResults(benchDir);
	if (results.length === 0) {
		console.error("no results yet - run bench/runner.ts or `a-coder-cli bench` first");
		process.exit(1);
	}
	const md = buildLeaderboard(results);
	const outPath = path.join(benchDir, "leaderboard.md");
	fs.writeFileSync(outPath, md + "\n");
	process.stdout.write(md);
	console.log(`\nwrote ${path.relative(process.cwd(), outPath)}`);
}

main();