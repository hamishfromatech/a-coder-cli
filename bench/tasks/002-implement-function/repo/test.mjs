import assert from "node:assert/strict";
import { slugify } from "./lib/slugify.js";

const cases = [
	["Hello World", "hello-world"],
	["  Multiple   Spaces  ", "multiple-spaces"],
	["Hello_World", "hello-world"],
	["Café & Bar!", "cafe-bar"],
];

let failed = 0;
for (const [input, expected] of cases) {
	try {
		assert.equal(slugify(input), expected);
	} catch (err) {
		failed++;
		console.error(`FAIL slugify(${JSON.stringify(input)}) => ${JSON.stringify(slugify(input))}, expected ${JSON.stringify(expected)}`);
	}
}
if (failed > 0) {
	console.error(`${failed}/${cases.length} failed`);
	process.exit(1);
}
console.log(`all ${cases.length} cases pass`);