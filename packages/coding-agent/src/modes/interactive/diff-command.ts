/**
 * `/diff [n]` — working-tree changes + per-turn file-history edits
 * (easy-agent /diff parity).
 *
 * Two sections:
 *   1. Git working tree: `git status --short` + `--shortstat` + the colored
 *      patch (budgeted so a huge tree can't flood the terminal).
 *   2. File history: what rewinding the last N user turns would restore
 *      (insertions/deletions per tracked file) — same data `/rewind` uses.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { theme } from "./theme/theme.ts";

const execFileAsync = promisify(execFile);

/** Total patch-line budget across all files (easy-agent MAX_PATCH_LINES). */
const MAX_PATCH_LINES = 400;
/** Max file paths listed for the file-history section. */
const MAX_FILE_LIST = 8;

export interface GitDiffFile {
	path: string;
	/** git status letter (M/A/D/R/?) from `git status --short`. */
	status: string;
	/** Raw patch lines for this file (may be budget-truncated). */
	lines: string[];
}

/** Parse `git diff` output into per-file patches. */
export function parseGitDiff(patch: string): GitDiffFile[] {
	const files: GitDiffFile[] = [];
	if (!patch) return files;

	let current: GitDiffFile | undefined;
	for (const line of patch.split("\n")) {
		if (line.startsWith("diff --git ")) {
			// "diff --git a/path b/path" — prefer the b/ path (post-image).
			const match = /^diff --git a\/(.*) b\/(.*)$/.exec(line);
			const path = (match?.[2] ?? match?.[1] ?? line.slice("diff --git ".length)).trim();
			current = { path, status: "M", lines: [] };
			files.push(current);
			continue;
		}
		if (!current) continue;
		// Skip metadata lines; keep hunks and content.
		if (
			line.startsWith("index ") ||
			line.startsWith("--- ") ||
			line.startsWith("+++ ") ||
			line.startsWith("new file mode") ||
			line.startsWith("deleted file mode") ||
			line.startsWith("similarity index") ||
			line.startsWith("rename from") ||
			line.startsWith("rename to") ||
			line.startsWith("Binary files")
		) {
			continue;
		}
		if (line.startsWith("@@") || line.startsWith("+") || line.startsWith("-") || line.startsWith(" ")) {
			current.lines.push(line);
		}
	}
	return files.filter((f) => f.lines.length > 0);
}

/** Parse `git diff --shortstat` output, e.g. " 3 files changed, 120 insertions(+), 45 deletions(-)". */
export function parseShortStat(text: string): { files: number; insertions: number; deletions: number } | null {
	const files = /(\d+) files? changed/.exec(text);
	if (!files) return null;
	const insertions = /(\d+) insertions?\(\+\)/.exec(text);
	const deletions = /(\d+) deletions?\(-\)/.exec(text);
	return {
		files: Number(files[1]),
		insertions: insertions ? Number(insertions[1]) : 0,
		deletions: deletions ? Number(deletions[1]) : 0,
	};
}

/** Parse `git status --short` into path → status-letter map. */
export function parseGitStatus(text: string): Map<string, string> {
	const map = new Map<string, string>();
	for (const line of text.split("\n")) {
		if (line.trim().length < 4) continue;
		const status = line.slice(0, 2).trim();
		let path = line.slice(3).trim();
		const rename = /(.*) -> (.*)$/.exec(path);
		if (rename) path = rename[2];
		if (path) map.set(path, status || "M");
	}
	return map;
}

/** File-history API subset the command needs (AgentSession satisfies this). */
export interface DiffCommandSession {
	fileHistory: {
		getSnapshotByOffset(offset: number): { messageId: string } | undefined;
		snapshotCount(): number;
		getDiffStats(messageId: string): Promise<{ filesChanged: string[]; insertions: number; deletions: number }>;
	};
}

async function runGit(cwd: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
	try {
		const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 16 * 1024 * 1024 });
		return { ok: true, stdout };
	} catch (error) {
		const err = error as { stdout?: string; message?: string };
		// git exits non-zero for `diff --shortstat` with no changes but still prints to stdout.
		if (err.stdout !== undefined) return { ok: true, stdout: err.stdout };
		return { ok: false, stdout: err.message ?? "" };
	}
}

function renderPatchLine(line: string): string {
	if (line.startsWith("+")) return theme.fg("toolDiffAdded", line);
	if (line.startsWith("-")) return theme.fg("toolDiffRemoved", line);
	if (line.startsWith("@@")) return theme.fg("dim", line);
	return theme.fg("muted", line);
}

/** Build the `/diff` output lines (theme-colored). */
export async function runDiffCommand(options: {
	session: DiffCommandSession;
	cwd: string;
	turns: number;
}): Promise<string[]> {
	const { session, cwd, turns } = options;
	const lines: string[] = [theme.bold("Working tree")];

	const repoCheck = await runGit(cwd, ["rev-parse", "--is-inside-work-tree"]);
	const isRepo = repoCheck.ok && repoCheck.stdout.trim() === "true";
	if (!isRepo) {
		lines.push(theme.fg("muted", "  not a git repository"));
	} else {
		const [status, shortstat, patch] = await Promise.all([
			runGit(cwd, ["status", "--short"]),
			runGit(cwd, ["diff", "--shortstat"]),
			runGit(cwd, ["diff"]),
		]);
		const statusByPath = parseGitStatus(status.stdout);
		const stat = parseShortStat(shortstat.stdout);
		if (stat) {
			lines.push(
				theme.fg(
					"dim",
					`  ${stat.files} file${stat.files === 1 ? "" : "s"} changed, ${stat.insertions} insertion${stat.insertions === 1 ? "" : "s"}(+), ${stat.deletions} deletion${stat.deletions === 1 ? "" : "s"}(-)`,
				),
			);
		} else {
			lines.push(theme.fg("muted", "  no unstaged changes"));
		}

		let budget = MAX_PATCH_LINES;
		let truncated = false;
		for (const file of parseGitDiff(patch.stdout)) {
			if (budget <= 0) {
				truncated = true;
				break;
			}
			const fileLines = file.lines.slice(0, budget);
			if (fileLines.length < file.lines.length) truncated = true;
			budget -= fileLines.length;
			const letter = statusByPath.get(file.path) ?? file.status;
			lines.push(theme.fg("accent", `${letter} ${file.path}`));
			for (const line of fileLines) lines.push(renderPatchLine(line));
		}
		if (truncated) {
			lines.push(
				theme.fg(
					"warning",
					`  … patch truncated at ${MAX_PATCH_LINES} lines — run \`git diff\` for the full output`,
				),
			);
		}
		const untracked = [...statusByPath.entries()].filter(([, s]) => s === "??").length;
		if (untracked > 0) {
			lines.push(
				theme.fg("dim", `  ${untracked} untracked file${untracked === 1 ? "" : "s"} (not in the patch above)`),
			);
		}
	}

	// File-history section: edits from the last N user turns.
	lines.push("", theme.bold("File history"));
	const snapshot = session.fileHistory.getSnapshotByOffset(turns);
	if (!snapshot || session.fileHistory.snapshotCount() === 0) {
		lines.push(theme.fg("muted", `  no tracked file edits in the last ${turns} turn${turns === 1 ? "" : "s"}`));
	} else {
		const stats = await session.fileHistory.getDiffStats(snapshot.messageId);
		if (stats.filesChanged.length === 0) {
			lines.push(theme.fg("muted", `  no tracked file edits in the last ${turns} turn${turns === 1 ? "" : "s"}`));
		} else {
			lines.push(
				theme.fg(
					"dim",
					`  rewinding ${turns} turn${turns === 1 ? "" : "s"} would change ${stats.filesChanged.length} file${stats.filesChanged.length === 1 ? "" : "s"}: +${stats.insertions} -${stats.deletions}`,
				),
			);
			for (const file of stats.filesChanged.slice(0, MAX_FILE_LIST)) {
				lines.push(theme.fg("muted", `    ${file}`));
			}
			if (stats.filesChanged.length > MAX_FILE_LIST) {
				lines.push(theme.fg("dim", `    … +${stats.filesChanged.length - MAX_FILE_LIST} more`));
			}
		}
	}

	return lines;
}
