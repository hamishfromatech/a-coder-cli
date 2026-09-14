// Hidden grader for 003-fix-off-by-one. No test file ships in the repo; the
// whole contract lives here.
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";

const failures = [];
const check = (name, fn) => {
	try {
		fn();
	} catch (err) {
		failures.push(`${name}: ${err instanceof Error ? err.message.slice(0, 200) : String(err)}`);
	}
};

let mod = null;
try {
	// Import from the agent's repo copy (the grader's cwd), not this file's dir.
	mod = await import(pathToFileURL(path.join(process.cwd(), "lib", "pager.js")).href);
} catch {
	failures.push("lib/pager.js does not import");
}

if (mod && typeof mod.pageItems === "function") {
	const items = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l"];
	const { pageItems } = mod;
	check("page 1", () => assert.deepEqual(pageItems(items, 1, 5), ["a", "b", "c", "d", "e"]));
	check("page 2", () => assert.deepEqual(pageItems(items, 2, 5), ["f", "g", "h", "i", "j"]));
	check("page 3 partial", () => assert.deepEqual(pageItems(items, 3, 5), ["k", "l"]));
	check("page 4 beyond last", () => assert.deepEqual(pageItems(items, 4, 5), []));
	check("page 99 far beyond", () => assert.deepEqual(pageItems(items, 99, 5), []));
	check("pageSize larger than list", () => assert.deepEqual(pageItems(items, 1, 50), items));
	check("empty list", () => assert.deepEqual(pageItems([], 1, 5), []));
	check("single item list", () => assert.deepEqual(pageItems(["x"], 1, 1), ["x"]));
	check("does not mutate input", () => {
		const input = ["a", "b", "c"];
		pageItems(input, 1, 2);
		assert.deepEqual(input, ["a", "b", "c"]);
	});
} else if (failures.length === 0) {
	failures.push("pageItems export missing");
}

const pass = failures.length === 0;
console.log(JSON.stringify({ pass, failures }));
process.exit(pass ? 0 : 1);