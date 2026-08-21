import { execFile } from "node:child_process";
import { access as fsAccess, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createAgentWorktree,
	findGitRoot,
	hasWorktreeChanges,
	isInsideGitRepo,
	removeAgentWorktree,
} from "../src/core/worktree.ts";

const exec = promisify(execFile);

async function git(args: string[], cwd: string): Promise<void> {
	await exec("git", args, {
		cwd,
		env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", HOME: process.env.HOME ?? "" },
	});
}

describe("worktree isolation utilities", () => {
	let repo: string;

	beforeEach(async () => {
		repo = await mkdtemp(join(tmpdir(), "pi-wt-"));
		await git(["init", "-q", "--initial-branch=main"], repo);
		await git(["config", "user.email", "test@test"], repo);
		await git(["config", "user.name", "test"], repo);
		await writeFile(join(repo, "README.md"), "hello\n");
		await git(["add", "."], repo);
		await exec("git", ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "init"], { cwd: repo });
	});

	afterEach(async () => {
		// worktrees may still be registered; prune before removing the temp dir
		await exec("git", ["worktree", "prune"], { cwd: repo }).catch(() => {});
		await rm(repo, { recursive: true, force: true });
	});

	it("detects a git repo and its root", async () => {
		expect(await isInsideGitRepo(repo)).toBe(true);
		expect(await findGitRoot(repo)).toBe(repo);
		const nested = join(repo, "deep", "nested");
		await mkdir(nested, { recursive: true });
		expect(await findGitRoot(nested)).toBe(repo);
	});

	it("returns null for a plain directory", async () => {
		const plain = await mkdtemp(join(tmpdir(), "pi-plain-"));
		try {
			expect(await isInsideGitRepo(plain)).toBe(false);
			expect(await findGitRoot(plain)).toBeNull();
		} finally {
			await rm(plain, { recursive: true, force: true });
		}
	});

	it("creates a worktree, reports no changes when clean, and removes it", async () => {
		const info = await createAgentWorktree("agent-explore", repo);
		expect(info.gitRoot).toBe(repo);
		expect(info.worktreePath).toContain(".a-coder-cli");
		expect(info.worktreeBranch).toBe("worktree-agent-explore");
		expect(await isInsideGitRepo(info.worktreePath)).toBe(true);

		// Fresh worktree checked out at HEAD → no changes vs baseline.
		expect(await hasWorktreeChanges(info.worktreePath, info.headCommit)).toBe(false);

		const res = await removeAgentWorktree(info);
		expect(res.ok).toBe(true);
		await expect(fsAccess(info.worktreePath)).rejects.toThrow();
	});

	it("reports changes when the worktree is dirtied", async () => {
		const info = await createAgentWorktree("agent-edit", repo);
		await writeFile(join(info.worktreePath, "new.txt"), "data\n");
		expect(await hasWorktreeChanges(info.worktreePath, info.headCommit)).toBe(true);
		// Dirty worktree → removeAgentWorktree still removes it (force); callers gate on hasWorktreeChanges.
		await removeAgentWorktree(info);
	});

	it("reports changes when a new commit is made on the worktree branch", async () => {
		const info = await createAgentWorktree("agent-commit", repo);
		await writeFile(join(info.worktreePath, "c.txt"), "x\n");
		await git(["add", "."], info.worktreePath);
		await exec("git", ["-c", "commit.gpgsign=false", "commit", "-q", "-m", "subagent work"], {
			cwd: info.worktreePath,
		});
		expect(await hasWorktreeChanges(info.worktreePath, info.headCommit)).toBe(true);
		await removeAgentWorktree(info);
	});

	it("throws when asked to create a worktree outside a repo", async () => {
		const plain = await mkdtemp(join(tmpdir(), "pi-norepo-"));
		try {
			await expect(createAgentWorktree("agent-x", plain)).rejects.toThrow(/not inside a git repository/);
		} finally {
			await rm(plain, { recursive: true, force: true });
		}
	});
});
