/**
 * Team metadata + on-disk TeamFile helpers.
 *
 * On-disk shape (mirrors easy-agent stage 21, minus tmux/terminal fields):
 *
 *   ~/.a-coder-cli/teams/<sanitized-team-name>/
 *   ├── team.json           ← TeamFile (read/write helpers in this file)
 *   └── inboxes/            ← per-teammate mailboxes (see mailbox.ts)
 *       └── <name>.json
 *
 * One team per process, but multiple writers (lead tools, teammate runner,
 * drain/wake cycles) interleave on the event loop — read-modify-write
 * sequences are serialized with a per-file keyed mutex, matching easy-agent's
 * proper-lockfile tolerance for concurrent writers without the cross-process
 * lock overhead.
 */

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getTeamsRoot } from "../../config.ts";
import { withKeyedLock } from "../../utils/async-mutex.ts";

export interface TeamMember {
	/** Deterministic id: `<name>@<teamName>`. */
	agentId: string;
	/** Human-friendly handle used by SendMessage as the `to` value. */
	name: string;
	/** Which agent definition backs this teammate (e.g. "general-purpose"). */
	agentType?: string;
	/** Model override the teammate runs under, if any. */
	model?: string;
	/** ms since epoch when the member was added. */
	joinedAt: number;
	/** False once the teammate's loop terminates (completed/failed/killed). */
	isActive: boolean;
	/** Worktree path the teammate operates in, when isolated. */
	worktreePath?: string;
	/** Branch paired with `worktreePath`. */
	worktreeBranch?: string;
	/** Repo root the worktree was created from. */
	gitRoot?: string;
}

export interface TeamFile {
	name: string;
	description?: string;
	createdAt: number;
	/** agentId of the team lead — also the first entry in `members`. */
	leadAgentId: string;
	members: TeamMember[];
}

/** Conventional name of the team lead in every team. */
export const TEAM_LEAD_NAME = "team-lead";

/** Filesystem-safe slug for a team/member name. */
export function sanitizeName(name: string): string {
	return name.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
}

/** Deterministic agent id from a member name + team name. */
export function formatAgentId(name: string, teamName: string): string {
	return `${name}@${teamName}`;
}

/** Returns `~/.a-coder-cli/teams/<sanitized-team-name>`. */
export function getTeamDir(teamName: string): string {
	return join(getTeamsRoot(), sanitizeName(teamName));
}

/** Returns `<teamDir>/team.json`. */
export function getTeamFilePath(teamName: string): string {
	return join(getTeamDir(teamName), "team.json");
}

/** Read a TeamFile; null on ENOENT or parse error. */
export async function readTeamFile(teamName: string): Promise<TeamFile | null> {
	try {
		const content = await readFile(getTeamFilePath(teamName), "utf-8");
		return JSON.parse(content) as TeamFile;
	} catch {
		return null;
	}
}

/** Write a TeamFile, creating parent dirs. */
export async function writeTeamFile(teamName: string, file: TeamFile): Promise<void> {
	await mkdir(getTeamDir(teamName), { recursive: true });
	await writeFile(getTeamFilePath(teamName), JSON.stringify(file, null, 2), "utf-8");
}

/**
 * Serialize a team-file read-modify-write so concurrent member updates
 * (spawn/finish/respawn + broadcasts) cannot drop each other's changes.
 */
function withTeamFileLock<T>(teamName: string, fn: () => Promise<T>): Promise<T> {
	return withKeyedLock(getTeamFilePath(teamName), fn);
}

/**
 * Append a member to the team. Idempotent on `name` — a same-named member is
 * replaced (covers respawning a crashed teammate). Returns null when the team
 * file doesn't exist.
 */
export async function addTeamMember(teamName: string, member: TeamMember): Promise<TeamFile | null> {
	return withTeamFileLock(teamName, async () => {
		const file = await readTeamFile(teamName);
		if (!file) return null;
		const filtered = file.members.filter((m) => m.name !== member.name);
		filtered.push(member);
		const next: TeamFile = { ...file, members: filtered };
		await writeTeamFile(teamName, next);
		return next;
	});
}

/** Set a member's active flag. Returns the updated TeamFile (or unchanged). */
export async function setMemberActive(
	teamName: string,
	memberName: string,
	isActive: boolean,
): Promise<TeamFile | null> {
	return withTeamFileLock(teamName, async () => {
		const file = await readTeamFile(teamName);
		if (!file) return null;
		let changed = false;
		const next: TeamFile = {
			...file,
			members: file.members.map((m) => {
				if (m.name === memberName && m.isActive !== isActive) {
					changed = true;
					return { ...m, isActive };
				}
				return m;
			}),
		};
		if (!changed) return file;
		await writeTeamFile(teamName, next);
		return next;
	});
}

/** Remove a member by name (no-op if absent). */
export async function removeTeamMember(teamName: string, memberName: string): Promise<TeamFile | null> {
	return withTeamFileLock(teamName, async () => {
		const file = await readTeamFile(teamName);
		if (!file) return null;
		const filtered = file.members.filter((m) => m.name !== memberName);
		if (filtered.length === file.members.length) return file;
		const next: TeamFile = { ...file, members: filtered };
		await writeTeamFile(teamName, next);
		return next;
	});
}

/** Recursive delete of the team's on-disk state. Best-effort. */
export async function cleanupTeamDirectory(teamName: string): Promise<void> {
	try {
		await rm(getTeamDir(teamName), { recursive: true, force: true });
	} catch {
		// Best-effort.
	}
}

/** Enumerate every team currently on disk (directory names). */
export async function listTeamNames(): Promise<string[]> {
	try {
		const entries = await readdir(getTeamsRoot(), { withFileTypes: true });
		return entries.filter((e) => e.isDirectory()).map((e) => e.name);
	} catch {
		return [];
	}
}
