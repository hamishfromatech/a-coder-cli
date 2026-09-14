// Hidden grader for 002-implement-function. Visible cases + extra edge cases
// the agent never sees (anti-overfit).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// The agent must not touch test.mjs.
const testSrc = fs.readFileSync("test.mjs", "utf8");
const testUntouched = testSrc.includes('["Hello World", "hello-world"]');

const visible = spawnSync(process.execPath, ["test.mjs"], { encoding: "utf8", timeout: 15000 });

const hiddenFailures = [];
const extra = [
	["A--B", "a-b"], // hyphen runs collapse
	["-leading and trailing-", "leading-and-trailing"],
	["Ærøskøbing 42", "rskbing-42"], // multi-char accents stripped to ASCII
	["123 456", "123-456"],
];

let mod = null;
try {
	// Import from the agent's repo copy (the grader's cwd), not this file's dir.
	mod = await import(pathToFileURL(path.join(process.cwd(), "lib", "slugify.js")).href);
} catch {
	mod = null;
}

if (mod && typeof mod.slugify === "function") {
	for (const [input, expected] of extra) {
		try {
			assert.equal(mod.slugify(input), expected);
		} catch {
			hiddenFailures.push(`${JSON.stringify(input)} -> ${JSON.stringify(mod.slugify(input))}, expected ${JSON.stringify(expected)}`);
		}
	}
} else {
	hiddenFailures.push("lib/slugify.js does not export slugify");
}

const pass = testUntouched && visible.status === 0 && hiddenFailures.length === 0;

console.log(
	JSON.stringify({
		pass,
		visibleTests: visible.status === 0 ? "pass" : `fail: ${(visible.stdout ?? "").trim().slice(0, 200)}`,
		hiddenFailures,
		testFileUntouched: testUntouched,
	}),
);
process.exit(pass ? 0 : 1);