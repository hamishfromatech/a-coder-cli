/**
 * Git worktree utilities for sub-agent isolation.
 *
 * Ported from easy-agent's src/utils/worktree.ts (which itself distills
 * claude-code's worktree helpers) down to the slice the sub-agent runner
 * needs:
 *
 *   - findGitRoot(cwd)         : walk up to the canonical repo root
 *   - isInsideGitRepo(cwd)     : cheap wrapper around findGitRoot
 *   - createAgentWorktree(...) : `git worktree add -B <branch> <path> HEAD`
 *   - hasWorktreeChanges(...)  : porcelain status + rev-list vs baseline — fail-closed
 *   - removeAgentWorktree(...) : `git worktree remove --force` + `branch -D`
 *
 * Path / branch convention:
 *
 *   <gitRoot>/.a-coder-cli/worktrees/<slug>/   ← worktree directory
 *   worktree-<slug>                             ← branch name
 *
 * Fail-closed semantics: hasWorktreeChanges treats any git error as "has
 * changes" so we never auto-delete a worktree we cannot prove is clean. The
 * caller preserves the worktree and surfaces its path in the completion
 * notification so the user can recover the work.
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const WORKTREES_SUBDIR = path.join(".a-coder-cli", "worktrees");

export interface WorktreeInfo {
	/** Absolute path to the worktree directory. */
	worktreePath: string;
	/** Branch name created/reset for this worktree. */
	worktreeBranch: string;
	/** HEAD SHA at creation time — baseline for hasWorktreeChanges. */
	headCommit: string;
	/** Repo root the worktree was created against. */
	gitRoot: string;
}

/** Flatten "/" so a slug containing it becomes a single dir-safe + branch-safe name. */
function flattenSlug(slug: string): string {
	return slug.replaceAll("/", "+");
}

function worktreeBranchName(slug: string): string {
	return `worktree-${flattenSlug(slug)}`;
}

function worktreePathFor(repoRoot: string, slug: string): string {
	return path.join(repoRoot, WORKTREES_SUBDIR, flattenSlug(slug));
}

/**
 * Walk upwards from `cwd` looking for a directory containing a `.git` entry
 * (file or directory — submodules and worktrees use a `.git` file). Returns
 * null when no enclosing repo is found. Deliberately avoids
 * `git rev-parse --show-toplevel`: it returns the worktree root rather than
 * the canonical repo root when already inside one, which would let nested
 * worktree mistakes happen.
 */
export async function findGitRoot(cwd: string): Promise<string | null> {
	let current = path.resolve(cwd);
	for (let i = 0; i < 64; i++) {
		try {
			await fs.stat(path.join(current, ".git"));
			return current;
		} catch {
			// not present here — keep walking
		}
		const parent = path.dirname(current);
		if (parent === current) return null;
		current = parent;
	}
	return null;
}

/** True if the cwd is inside a git repository. */
export async function isInsideGitRepo(cwd: string): Promise<boolean> {
	return (await findGitRoot(cwd)) !== null;
}

interface ExecResult {
	code: number;
	stdout: string;
	stderr: string;
}

/**
 * Run `git ...` and return code/stdout/stderr without throwing, so callers
 * can branch on the exit code and inspect stderr.
 */
async function git(args: string[], cwd: string): Promise<ExecResult> {
	try {
		const { stdout, stderr } = await execFileAsync("git", args, {
			cwd,
			maxBuffer: 16 * 1024 * 1024,
			windowsHide: true,
		});
		return { code: 0, stdout, stderr };
	} catch (error: unknown) {
		const e = error as NodeJS.ErrnoException & { code?: number | string; stdout?: string; stderr?: string };
		const code = typeof e?.code === "number" ? e.code : 127;
		return {
			code,
			stdout: e?.stdout ?? "",
			stderr: e?.stderr ?? (error instanceof Error ? error.message : String(error)),
		};
	}
}

/**
 * Create a worktree dedicated to one sub-agent invocation:
 *   1. Resolve HEAD SHA — baseline for later change detection.
 *   2. mkdir -p `<gitRoot>/.a-coder-cli/worktrees/`.
 *   3. `git worktree add -B worktree-<slug> <path> HEAD` — `-B` resets a
 *      stale branch from a previous run.
 *
 * Throws on failure; the caller falls back to "no isolation" with a warning
 * rather than aborting the sub-agent.
 */
export async function createAgentWorktree(slug: string, cwd: string): Promise<WorktreeInfo> {
	const gitRoot = await findGitRoot(cwd);
	if (!gitRoot) {
		throw new Error(`Cannot create worktree: ${cwd} is not inside a git repository.`);
	}

	const head = await git(["rev-parse", "HEAD"], gitRoot);
	if (head.code !== 0) {
		throw new Error(`Failed to read HEAD in ${gitRoot}: ${head.stderr.trim() || "git rev-parse HEAD failed"}`);
	}
	const headCommit = head.stdout.trim();

	const worktreePath = worktreePathFor(gitRoot, slug);
	const worktreeBranch = worktreeBranchName(slug);

	await fs.mkdir(path.dirname(worktreePath), { recursive: true });

	const add = await git(["worktree", "add", "-B", worktreeBranch, worktreePath, "HEAD"], gitRoot);
	if (add.code !== 0) {
		throw new Error(`git worktree add failed: ${add.stderr.trim() || `exit ${add.code}`}`);
	}

	return { worktreePath, worktreeBranch, headCommit, gitRoot };
}

/**
 * Detect whether the worktree has changes worth preserving:
 *   - `git status --porcelain` non-empty → uncommitted/staged/untracked files
 *   - `git rev-list --count <baseline>..HEAD` > 0 → new commits
 * Fail-closed: any git error returns true.
 */
export async function hasWorktreeChanges(worktreePath: string, headCommit: string): Promise<boolean> {
	const status = await git(["status", "--porcelain"], worktreePath);
	if (status.code !== 0) return true;
	if (status.stdout.trim().length > 0) return true;

	const revList = await git(["rev-list", "--count", `${headCommit}..HEAD`], worktreePath);
	if (revList.code !== 0) return true;
	const count = Number.parseInt(revList.stdout.trim(), 10);
	if (Number.isFinite(count) && count > 0) return true;

	return false;
}

/**
 * Tear down a worktree: `git worktree remove --force` then `branch -D`.
 * Best-effort — returns `{ ok, error? }`; both steps are attempted even if
 * the first fails (the worktree may already be gone from a previous run).
 */
export async function removeAgentWorktree(
	info: Pick<WorktreeInfo, "worktreePath" | "worktreeBranch" | "gitRoot">,
): Promise<{ ok: boolean; error?: string }> {
	const errors: string[] = [];

	const remove = await git(["worktree", "remove", "--force", info.worktreePath], info.gitRoot);
	if (remove.code !== 0) {
		errors.push(`worktree remove: ${remove.stderr.trim() || `exit ${remove.code}`}`);
	}

	const branchDelete = await git(["branch", "-D", info.worktreeBranch], info.gitRoot);
	if (branchDelete.code !== 0) {
		errors.push(`branch -D: ${branchDelete.stderr.trim() || `exit ${branchDelete.code}`}`);
	}

	if (errors.length > 0) return { ok: false, error: errors.join("; ") };
	return { ok: true };
}
