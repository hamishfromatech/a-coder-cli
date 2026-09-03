import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import {
	buildContextBreakdownLines,
	roughJsonTokens,
	roughTextTokens,
} from "../src/modes/interactive/context-command.ts";
import {
	type DiffCommandSession,
	parseGitDiff,
	parseGitStatus,
	parseShortStat,
	runDiffCommand,
} from "../src/modes/interactive/diff-command.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { stripAnsi } from "../src/utils/ansi.ts";

const execFileAsync = promisify(execFile);

describe("context-command", () => {
	test("rough token estimates", () => {
		expect(roughTextTokens("abcd")).toBe(1);
		expect(roughTextTokens("")).toBe(0);
		expect(roughJsonTokens("12345678")).toBe(4);
	});

	test("breakdown rows render bars, percentages and totals", () => {
		initTheme("dark");
		const lines = buildContextBreakdownLines({
			modelId: "test-model",
			contextWindow: 1000,
			systemPrompt: "a".repeat(400), // 100 tokens
			toolsJson: "b".repeat(200), // 100 tokens
			historyTokens: 700,
		});
		const text = stripAnsi(lines.join("\n"));
		expect(text).toContain("Context usage (test-model)");
		expect(text).toContain("Context window: 1,000 tokens");
		expect(text).toContain("System prompt");
		expect(text).toContain("Tool definitions");
		expect(text).toContain("Conversation history");
		expect(text).toContain("Free space");
		expect(text).toContain("Estimated used: 900 / 1,000 (90.0%)");
		expect(text).toContain("█░");
		// Over the 80% threshold → compaction hint.
		expect(text).toContain("Approaching the auto-compact threshold");
	});

	test("no warning below 80% usage", () => {
		initTheme("dark");
		const lines = buildContextBreakdownLines({
			modelId: "test-model",
			contextWindow: 1000,
			systemPrompt: "a".repeat(400),
			toolsJson: "",
			historyTokens: 100,
		});
		expect(stripAnsi(lines.join("\n"))).not.toContain("auto-compact threshold");
	});
});

describe("diff-command parsers", () => {
	test("parseGitDiff splits files and skips metadata", () => {
		const patch = [
			"diff --git a/src/a.ts b/src/a.ts",
			"index 111..222 100644",
			"--- a/src/a.ts",
			"+++ b/src/a.ts",
			"@@ -1,3 +1,4 @@",
			" unchanged",
			"-old line",
			"+new line",
			"diff --git a/src/b.ts b/src/b.ts",
			"new file mode 100644",
			"@@ -0,0 +1,1 @@",
			"+created",
		].join("\n");
		const files = parseGitDiff(patch);
		expect(files).toHaveLength(2);
		expect(files[0].path).toBe("src/a.ts");
		expect(files[0].lines).toEqual(["@@ -1,3 +1,4 @@", " unchanged", "-old line", "+new line"]);
		expect(files[1].path).toBe("src/b.ts");
		expect(files[1].lines).toEqual(["@@ -0,0 +1,1 @@", "+created"]);
	});

	test("parseShortStat handles singular and zero-deletion forms", () => {
		expect(parseShortStat(" 3 files changed, 120 insertions(+), 45 deletions(-)")).toEqual({
			files: 3,
			insertions: 120,
			deletions: 45,
		});
		expect(parseShortStat(" 1 file changed, 2 insertions(+)")).toEqual({
			files: 1,
			insertions: 2,
			deletions: 0,
		});
		expect(parseShortStat("")).toBeNull();
	});

	test("parseGitStatus maps statuses and rename arrows", () => {
		const map = parseGitStatus(["M  src/a.ts", "?? new.txt", "R  old.ts -> new.ts", ""].join("\n"));
		expect(map.get("src/a.ts")).toBe("M");
		expect(map.get("new.txt")).toBe("??");
		expect(map.get("old.ts")).toBeUndefined();
		expect(map.get("b.ts")).toBeUndefined();
	});
});

describe("runDiffCommand", () => {
	let repoDir: string;
	let fileA: string;

	beforeAll(() => {
		repoDir = mkdtempSync(join(tmpdir(), "diff-cmd-"));
	});

	afterAll(() => {
		rmSync(repoDir, { recursive: true, force: true });
	});

	function makeFakeSession(): DiffCommandSession {
		return {
			fileHistory: {
				getSnapshotByOffset: (offset: number) => (offset === 1 ? { messageId: "turn-1" } : undefined),
				snapshotCount: () => 2,
				getDiffStats: async (messageId: string) => {
					expect(messageId).toBe("turn-1");
					return {
						filesChanged: [join(repoDir, "src/a.ts"), "src/c.ts"],
						insertions: 12,
						deletions: 3,
					};
				},
			},
		};
	}

	test("renders git working-tree patch and file-history section", async () => {
		await execFileAsync("git", ["init", "-q"], { cwd: repoDir });
		fileA = join(repoDir, "a.txt");
		writeFileSync(fileA, "one\n");
		await execFileAsync("git", ["add", "a.txt"], { cwd: repoDir });
		await execFileAsync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "init"], {
			cwd: repoDir,
		});
		writeFileSync(fileA, "one\ntwo\nthree\n");

		const lines = await runDiffCommand({ session: makeFakeSession(), cwd: repoDir, turns: 1 });
		const text = stripAnsi(lines.join("\n"));
		expect(text).toContain("Working tree");
		expect(text).toContain("1 file changed");
		expect(text).toContain("M a.txt");
		expect(text).toContain("+two");
		expect(text).toContain("+three");
		expect(text).toContain("File history");
		expect(text).toContain("rewinding 1 turn would change 2 files: +12 -3");
		expect(text).toContain("src/c.ts");
	});

	test("non-repo directory reports gracefully", async () => {
		const plain = mkdtempSync(join(tmpdir(), "diff-plain-"));
		try {
			const lines = await runDiffCommand({ session: makeFakeSession(), cwd: plain, turns: 1 });
			const text = stripAnsi(lines.join("\n"));
			expect(text).toContain("not a git repository");
			expect(text).toContain("File history");
		} finally {
			rmSync(plain, { recursive: true, force: true });
		}
	});

	test("no snapshot reports no tracked edits", async () => {
		const session: DiffCommandSession = {
			fileHistory: {
				getSnapshotByOffset: () => undefined,
				snapshotCount: () => 0,
				getDiffStats: async () => ({ filesChanged: [], insertions: 0, deletions: 0 }),
			},
		};
		const lines = await runDiffCommand({ session, cwd: repoDir, turns: 5 });
		expect(stripAnsi(lines.join("\n"))).toContain("no tracked file edits in the last 5 turns");
	});
});
