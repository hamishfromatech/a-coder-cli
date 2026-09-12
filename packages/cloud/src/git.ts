import { spawn as nodeSpawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { GIT_COMMIT_IDENTITY_EMAIL, GIT_COMMIT_IDENTITY_NAME } from "./config.ts";
import type { CommitSummary } from "./types.ts";

export class GitError extends Error {
	readonly args: string[];
	readonly stderr: string;

	constructor(message: string, args: string[], stderr: string) {
		super(`${message} (git ${args.join(" ")})${stderr ? `: ${stderr}` : ""}`);
		this.args = args;
		this.stderr = stderr;
	}
}

export interface GitDiffSummary {
	commits: CommitSummary[];
	diffStat: string;
	changedFiles: string[];
}

function execGit(cwd: string, args: string[], input?: string): Promise<string> {
	return new Promise<string>((resolve, reject) => {
		const child = nodeSpawn("git", args, {
			cwd,
			env: process.env,
			stdio: ["pipe", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => {
			stdout += chunk;
		});
		child.stderr.on("data", (chunk: string) => {
			stderr += chunk;
		});
		child.on("error", (error) => {
			reject(new GitError(String(error), args, stderr));
		});
		child.on("close", (code) => {
			if (code === 0) {
				resolve(stdout);
				return;
			}
			reject(new GitError(`git exited with code ${code}`, args, stderr.trim()));
		});
		if (input !== undefined) {
			child.stdin.end(input);
		} else {
			child.stdin.end();
		}
	});
}

const COMMIT_IDENTITY_ARGS = [
	"-c",
	`user.name=${GIT_COMMIT_IDENTITY_NAME}`,
	"-c",
	`user.email=${GIT_COMMIT_IDENTITY_EMAIL}`,
];

/** Clone a repo (git URL or local path) into dest. */
export async function cloneRepo(source: string, dest: string): Promise<void> {
	// Run from the parent dir: dest does not exist until git creates it.
	await execGit(dirname(dest), ["clone", source, dest]);
}

/** Return true when the directory exists and is a git work tree. */
export async function isGitRepo(dir: string): Promise<boolean> {
	if (!existsSync(dir)) return false;
	try {
		await execGit(dir, ["rev-parse", "--is-inside-work-tree"]);
		return true;
	} catch {
		return false;
	}
}

export async function currentSha(dir: string): Promise<string> {
	return (await execGit(dir, ["rev-parse", "HEAD"])).trim();
}

export async function branchExists(dir: string, branch: string): Promise<boolean> {
	try {
		await execGit(dir, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]);
		return true;
	} catch {
		return false;
	}
}

/**
 * Resolve the branch a task should start from. Explicit `base` wins; otherwise
 * the remote default branch (origin/HEAD) when available, otherwise current HEAD.
 */
export async function resolveBaseBranch(dir: string, base?: string): Promise<string> {
	if (base && base.trim().length > 0) {
		const trimmed = base.trim();
		if (!(await branchExists(dir, trimmed))) {
			try {
				await execGit(dir, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${trimmed}`]);
				return trimmed;
			} catch {
				throw new GitError(`base branch not found: ${trimmed}`, ["rev-parse"], "");
			}
		}
		return trimmed;
	}
	try {
		const output = (await execGit(dir, ["symbolic-ref", "refs/remotes/origin/HEAD"])).trim();
		const name = output.replace("refs/remotes/origin/", "");
		if (name.length > 0) return name;
	} catch {
		// fall through to detached HEAD default
	}
	return "HEAD";
}

/** Create/reset the task branch at base and check it out. */
export async function checkoutTaskBranch(dir: string, branch: string, base: string): Promise<void> {
	const baseRef = base === "HEAD" ? [] : [base];
	await execGit(dir, ["checkout", "-B", branch, ...baseRef]);
}

export async function hasUncommittedChanges(dir: string): Promise<boolean> {
	const status = await execGit(dir, ["status", "--porcelain"]);
	return status.trim().length > 0;
}

/**
 * Commit everything in the work tree as a checkpoint. Returns the new sha, or
 * undefined when there was nothing to commit.
 */
export async function commitAll(dir: string, message: string): Promise<string | undefined> {
	if (!(await hasUncommittedChanges(dir))) {
		return undefined;
	}
	await execGit(dir, ["add", "-A"]);
	await execGit(dir, [...COMMIT_IDENTITY_ARGS, "commit", "-m", message]);
	return currentSha(dir);
}

/** List commits on head that are not on base. */
export async function listCommits(dir: string, base: string, head = "HEAD"): Promise<CommitSummary[]> {
	const raw = await execGit(dir, ["log", "--format=%H%x1f%s%x1f%aI", `${base}..${head}`]);
	const commits: CommitSummary[] = [];
	for (const line of raw.split("\n")) {
		if (line.trim().length === 0) continue;
		const [hash, subject, date] = line.split("\x1f");
		commits.push({ hash, subject: subject ?? "", date: date ?? "" });
	}
	return commits;
}

/** Unified diffstat between base and head. */
export async function diffStat(dir: string, base: string, head = "HEAD"): Promise<string> {
	return (await execGit(dir, ["diff", "--stat", base, head])).trim();
}

/** Files changed between base and head. */
export async function listChangedFiles(dir: string, base: string, head = "HEAD"): Promise<string[]> {
	const raw = await execGit(dir, ["diff", "--name-only", base, head]);
	return raw
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line.length > 0);
}

/**
 * Push the task branch to origin when a remote exists. Returns true when the
 * push happened, false when there is no origin, and throws on push failure
 * only if `required` is set.
 */
export async function pushBranch(dir: string, branch: string, options?: { required?: boolean }): Promise<boolean> {
	try {
		await execGit(dir, ["remote", "get-url", "origin"]);
	} catch {
		return false;
	}
	try {
		await execGit(dir, ["push", "-u", "origin", branch]);
		return true;
	} catch (error) {
		if (options?.required) {
			throw error;
		}
		return false;
	}
}

export async function hasRemoteOrigin(dir: string): Promise<boolean> {
	try {
		await execGit(dir, ["remote", "get-url", "origin"]);
		return true;
	} catch {
		return false;
	}
}

/** Diff summary between the task base and current HEAD, all in one shot. */
export async function diffSummary(dir: string, base: string): Promise<GitDiffSummary> {
	const [commits, stat, files] = await Promise.all([
		listCommits(dir, base),
		diffStat(dir, base),
		listChangedFiles(dir, base),
	]);
	return { commits, diffStat: stat, changedFiles: files };
}
