// Hidden grader for 005-refactor-extract: behavior preserved + the extraction
// actually happened (new module exists, reports.js imports it).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const failures = [];
const check = (name, fn) => {
	try {
		fn();
	} catch (err) {
		failures.push(`${name}: ${err instanceof Error ? err.message.slice(0, 250) : String(err)}`);
	}
};

// 1. Behavior: demo output unchanged.
const run = spawnSync(process.execPath, ["main.js"], { encoding: "utf8", timeout: 15000 });
check("main.js runs clean", () => assert.equal(run.status, 0));
const expectedOutput = [
	"weekly: 2 events (2026-01-01T00:00:00.000Z .. 2026-01-31T23:59:59.999Z)",
	"monthly: 1 events (2026-02-01T00:00:00.000Z .. 2026-02-28T23:59:59.999Z)",
	"quarterly: 4 events (2026-01-01T00:00:00.000Z .. 2026-03-15T23:59:59.999Z)",
	"weekly: 4 events (beginning .. now)",
];
check("demo output unchanged", () => assert.deepEqual((run.stdout ?? "").trim().split("\n"), expectedOutput));

// 2. The extraction exists and behaves.
let dr = null;
try {
	// Import from the agent's repo copy (the grader's cwd), not this file's dir.
	dr = await import(pathToFileURL(path.join(process.cwd(), "lib", "dateRange.js")).href);
} catch {
	failures.push("lib/dateRange.js missing or does not import");
}
if (dr && typeof dr.clampDateRange === "function") {
	check("clampDateRange basic", () => {
		const r = dr.clampDateRange("2026-01-01", "2026-01-31");
		assert.deepEqual(Object.keys(r).sort(), ["end", "start"]);
		assert.equal(r.start, "2026-01-01T00:00:00.000Z");
		assert.equal(r.end, "2026-01-31T23:59:59.999Z");
	});
	check("clampDateRange swaps reversed range", () => {
		const r = dr.clampDateRange("2026-03-01", "2026-01-01");
		assert.equal(r.start, "2026-01-01T00:00:00.000Z");
		assert.equal(r.end, "2026-03-01T23:59:59.999Z");
	});
	check("clampDateRange handles nulls", () => {
		const r = dr.clampDateRange(null, null);
		assert.equal(r.start, null);
		assert.equal(r.end, null);
	});
} else if (failures.length === 0) {
	failures.push("clampDateRange export missing from lib/dateRange.js");
}

// 3. The refactor actually wired through: reports.js references dateRange.
check("reports.js uses the new module", () => {
	const src = fs.readFileSync("lib/reports.js", "utf8");
	assert.ok(src.includes("dateRange"), "reports.js should import lib/dateRange.js");
});

const pass = failures.length === 0;
console.log(JSON.stringify({ pass, failures }));
process.exit(pass ? 0 : 1);