import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	checkoutTaskBranch,
	cloneRepo,
	commitAll,
	currentSha,
	diffSummary,
	hasUncommittedChanges,
	isGitRepo,
	listChangedFiles,
	pushBranch,
	resolveBaseBranch,
} from "../src/git.ts";

function git(cwd: string, args: string[]): string {
	return execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@test", ...args], {
		cwd,
		encoding: "utf8",
	});
}

let repoDir = "";
let tempRoot = "";

beforeAll(() => {
	tempRoot = mkdtempSync(join(tmpdir(), "pi-cloud-git-"));
	repoDir = join(tempRoot, "repo");
	execFileSync("git", ["init", "--initial-branch=main", repoDir]);
	git(repoDir, ["commit", "--allow-empty", "-m", "init"]);
	writeFileSync(join(repoDir, "a.txt"), "hello\n");
	git(repoDir, ["add", "."]);
	git(repoDir, ["commit", "-m", "add a.txt"]);
});

afterAll(() => {
	rmSync(tempRoot, { recursive: true, force: true });
});

describe("git layer", () => {
	it("detects a git repo", async () => {
		expect(await isGitRepo(repoDir)).toBe(true);
		expect(await isGitRepo(join(tempRoot, "nope"))).toBe(false);
	});

	it("resolves base branch from HEAD when no remote exists", async () => {
		const base = await resolveBaseBranch(repoDir);
		expect(base).toBe("HEAD");
	});

	it("resolves an explicit base branch", async () => {
		expect(await resolveBaseBranch(repoDir, "main")).toBe("main");
	});

	it("creates and checks out the task branch", async () => {
		await checkoutTaskBranch(repoDir, "ac-cloud/test1", "main");
		const branch = execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
			cwd: repoDir,
			encoding: "utf8",
		}).trim();
		expect(branch).toBe("ac-cloud/test1");
	});

	it("commitAll commits only when there are changes", async () => {
		const cleanSha = await commitAll(repoDir, "nothing to do");
		expect(cleanSha).toBeUndefined();

		writeFileSync(join(repoDir, "b.txt"), "world\n");
		const sha = await commitAll(repoDir, "add b.txt");
		expect(sha).toBeTruthy();
		expect(await hasUncommittedChanges(repoDir)).toBe(false);
	});

	it("summarizes commits, diffstat, and changed files", async () => {
		const summary = await diffSummary(repoDir, "main");
		expect(summary.commits.length).toBeGreaterThanOrEqual(1);
		expect(summary.commits.some((c) => c.subject === "add b.txt")).toBe(true);
		expect(summary.changedFiles).toContain("b.txt");
		expect(summary.diffStat).toContain("b.txt");
	});

	it("listChangedFiles works directly", async () => {
		const files = await listChangedFiles(repoDir, "main");
		expect(files).toContain("b.txt");
	});

	it("pushBranch returns false with no origin remote", async () => {
		expect(await pushBranch(repoDir, "ac-cloud/test1")).toBe(false);
	});

	it("clones a local repo and preserves history", async () => {
		const dest = join(tempRoot, "clone");
		await cloneRepo(repoDir, dest);
		expect(await isGitRepo(dest)).toBe(true);
		const sha = await currentSha(dest);
		expect(sha).toBe(await currentSha(repoDir));
	});
});
