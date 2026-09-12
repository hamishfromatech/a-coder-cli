import { describe, expect, it } from "vitest";
import { buildReport } from "../src/report.ts";
import type { CloudTask, GitDiffSummaryLike } from "../src/types.ts";

function makeTask(overrides?: Partial<CloudTask>): CloudTask {
	const now = "2026-09-12T10:00:00.000Z";
	return {
		id: "abcd1234efgh",
		createdAt: now,
		updatedAt: now,
		repoSource: "/tmp/repo",
		workspacePath: "/home/user/.a-coder/cloud/workspaces/abcd1234efgh",
		baseBranch: "main",
		baseSha: "abcdef1234567890",
		branch: "ac-cloud/abcd1234efgh",
		prompt: "Fix the flaky login test.",
		timeoutMinutes: 30,
		push: false,
		status: "done",
		commits: [],
		changedFiles: [],
		usage: {
			inputTokens: 12000,
			outputTokens: 3000,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 15000,
			turns: 4,
			toolCalls: 9,
			toolErrors: 1,
		},
		warnings: [],
		...overrides,
	};
}

const diff: GitDiffSummaryLike = {
	commits: [
		{ hash: "0123456789abcdef", subject: "fix: unskip flaky login test", date: "2026-09-12T10:05:00.000Z" },
		{ hash: "fedcba9876543210", subject: "final checkpoint", date: "2026-09-12T10:06:00.000Z" },
	],
	diffStat: " test/login.test.ts | 4 ++--\n 1 file changed, 2 insertions(+), 2 deletions(-)",
	changedFiles: ["test/login.test.ts"],
};

describe("report builder", () => {
	it("builds structured JSON with task facts", () => {
		const payload = buildReport(makeTask(), diff);
		expect(payload.json.taskId).toBe("abcd1234efgh");
		expect(payload.json.branch).toBe("ac-cloud/abcd1234efgh");
		expect(payload.json.status).toBe("done");
		expect(payload.json.changedFiles).toEqual(["test/login.test.ts"]);
	});

	it("markdown contains commits, changes, usage, and continuation steps", () => {
		const { markdown } = buildReport(makeTask(), diff);
		expect(markdown).toContain("# A-Coder Cloud report");
		expect(markdown).toContain("fix: unskip flaky login test");
		expect(markdown).toContain(diff.diffStat);
		expect(markdown).toContain("4 turn(s)");
		expect(markdown).toContain("a-coder --resume");
		expect(markdown).toContain("git merge --no-ff ac-cloud/abcd1234efgh");
	});

	it("surfaces errors and warnings", () => {
		const { markdown, json } = buildReport(
			makeTask({ status: "error", error: "Timed out", warnings: ["no origin remote"] }),
			{
				commits: [],
				diffStat: "",
				changedFiles: [],
			},
		);
		expect(markdown).toContain("Timed out");
		expect(markdown).toContain("no origin remote");
		expect(json.error).toBe("Timed out");
	});
});
