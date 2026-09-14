// Hidden grader for 004-precise-json-edit: exact structural equality with the
// expected final config - catches both under-editing and collateral changes.
import assert from "node:assert/strict";
import fs from "node:fs";

const expected = {
	name: "acme-backend",
	version: "1.4.2",
	services: {
		auth: { port: 3000, retries: 0, upstream: "internal-auth:9000" },
		payments: { port: 8443, retries: { count: 3, backoff: "exponential" }, upstream: "billing-core:7000" },
		search: { port: 9200, retries: 0, upstream: "indexer:9200" },
	},
	features: { darkMode: true, betaSearch: false },
};

const failures = [];
let actual = null;
try {
	actual = JSON.parse(fs.readFileSync("config.json", "utf8"));
} catch (err) {
	failures.push(`config.json does not parse: ${err instanceof Error ? err.message.slice(0, 120) : String(err)}`);
}

if (actual) {
	check("deep equality with expected config", () => assert.deepEqual(actual, expected));
	const raw = fs.readFileSync("config.json", "utf8");
	check("payments.retries is an object", () => {
		const parsed = JSON.parse(raw);
		assert.equal(typeof parsed.services.payments.retries, "object");
	});
	check("indentation preserved (2-space)", () => assert.ok(raw.includes('\n  "name"'), "expected 2-space indent"));
}

function check(name, fn) {
	try {
		fn();
	} catch (err) {
		failures.push(`${name}: ${err instanceof Error ? err.message.slice(0, 300) : String(err)}`);
	}
}

const pass = failures.length === 0;
console.log(JSON.stringify({ pass, failures }));
process.exit(pass ? 0 : 1);