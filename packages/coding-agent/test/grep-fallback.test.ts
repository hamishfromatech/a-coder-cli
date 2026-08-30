import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildGrepFallbackArguments, runGrepFallback } from "../src/core/tools/grep.ts";

describe("grep(1) fallback (ripgrep unavailable)", () => {
	const tempDir = join(tmpdir(), `pi-grep-fallback-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	function setup(): string {
		mkdirSync(join(tempDir, "src"), { recursive: true });
		writeFileSync(
			join(tempDir, "src", "alpha.ts"),
			["export function alpha() {", "\treturn 'needle';", "}", ""].join("\n"),
		);
		writeFileSync(join(tempDir, "beta.md"), ["# notes", "the needle is also here", ""].join("\n"));
		return tempDir;
	}

	it("builds grep arguments mirroring the ripgrep input", () => {
		expect(buildGrepFallbackArguments({ pattern: "x", searchPath: "." })).toEqual(["-R", "-n", "-E", "--", "x", "."]);
		expect(
			buildGrepFallbackArguments({
				pattern: "x",
				searchPath: ".",
				ignoreCase: true,
				literal: true,
				glob: "*.ts",
				context: 2,
			}),
		).toEqual(["-R", "-n", "-F", "-i", "--include", "*.ts", "-C", "2", "--", "x", "."]);
	});

	it("finds matches with relative paths and line numbers", async () => {
		const dir = setup();
		const result = await runGrepFallback({ pattern: "needle" }, dir, 100);
		expect(result.matchCount).toBe(2);
		expect(result.matchLimitReached).toBe(false);
		// grep's file traversal order is filesystem-dependent.
		expect(result.outputLines.sort()).toEqual(
			["src/alpha.ts:2: \treturn 'needle';", "beta.md:2: the needle is also here"].sort(),
		);
	});

	it("treats patterns as literals with literal: true", async () => {
		const dir = setup();
		const regex = await runGrepFallback({ pattern: "alp(a|b)" }, dir, 100);
		expect(regex.matchCount).toBe(0); // ERE finds nothing... except alpha has 'alpha'
		const literal = await runGrepFallback({ pattern: "alpha() {", literal: true }, dir, 100);
		expect(literal.matchCount).toBe(1);
	});

	it("reports no matches cleanly for grep exit code 1", async () => {
		const dir = setup();
		const result = await runGrepFallback({ pattern: "no-such-token-xyz" }, dir, 100);
		expect(result.matchCount).toBe(0);
		expect(result.outputLines).toEqual([]);
	});

	it("stops at the match limit (BSD-style file pruning may vary)", async () => {
		const dir = setup();
		const result = await runGrepFallback({ pattern: "needle", ignoreCase: true }, dir, 1);
		expect(result.matchCount).toBe(1);
		expect(result.matchLimitReached).toBe(true);
	});

	it("rejects with a helpful error for missing paths", async () => {
		await expect(runGrepFallback({ pattern: "x" }, join(tempDir, "nope"), 100)).rejects.toThrow();
	});
});
