#!/usr/bin/env node
/**
 * Regenerates packages/coding-agent/src/bench/starter-tasks.generated.ts from
 * bench/tasks/. Run after editing bench task definitions:
 *
 *   node scripts/generate-bench-tasks.mjs
 *
 * The embedded snapshot lets installed CLIs (npm package / bun binary)
 * scaffold starter bench tasks without a repository checkout.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tasksDir = path.join(repoRoot, "bench", "tasks");
const outFile = path.join(repoRoot, "packages", "coding-agent", "src", "bench", "starter-tasks.generated.ts");

if (!fs.existsSync(tasksDir)) {
	console.error(`no tasks directory at ${tasksDir}`);
	process.exit(1);
}

/** @type {Record<string, string>} */
const files = {};
for (const entry of fs.readdirSync(tasksDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
	if (!entry.isDirectory()) continue;
	for (const abs of collectFiles(path.join(tasksDir, entry.name))) {
		const relative = path.relative(tasksDir, abs).split(path.sep).join("/");
		files[relative] = fs.readFileSync(abs, "utf8");
	}
}

function collectFiles(dir) {
	const out = [];
	for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) out.push(...collectFiles(p));
		else out.push(p);
	}
	return out;
}

const header = `// GENERATED FILE - do not edit by hand.
// Regenerate with: node scripts/generate-bench-tasks.mjs
//
// Embedded snapshot of the A-Coder Bench starter tasks (bench/tasks/ in the
// repository). Installed CLIs materialize these when no bench/tasks exists
// nearby, so the bench works out of the box from any directory.

/**
 * Embedded starter bench tasks: repo-relative path (bench/tasks/<...>) ->
 * file contents. Never overwrite files that already exist on disk.
 */
export const STARTER_TASK_FILES: Readonly<Record<string, string>> = ${JSON.stringify(files, null, "\t")};
`;

fs.writeFileSync(outFile, header);
console.log(`wrote ${path.relative(repoRoot, outFile)} (${Object.keys(files).length} files)`);