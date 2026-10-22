/**
 * Routine revision history.
 *
 * Revisions live beside the jobs at `<agentDir>/cron/revisions.json`, keyed by
 * job id. A revision stores only the user-editable config, never run state or
 * session pointers, so restoring one cannot silently move a routine to a
 * different project or session.
 */

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAgentDir } from "../../config.ts";
import { withKeyedLock } from "../../utils/async-mutex.ts";
import type { CronJobRevision } from "./types.ts";

export const MAX_REVISIONS_PER_JOB = 20;

function revisionsPath(): string {
	return join(getAgentDir(), "cron", "revisions.json");
}

type RevisionMap = Record<string, CronJobRevision[]>;

async function readRevisions(path = revisionsPath()): Promise<RevisionMap> {
	try {
		const content = await readFile(path, "utf-8");
		const parsed = JSON.parse(content) as unknown;
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as RevisionMap) : {};
	} catch {
		return {};
	}
}

async function writeRevisions(path: string, revisions: RevisionMap): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(tmp, JSON.stringify(revisions, null, "\t"), "utf-8");
	await rename(tmp, path);
}

export function mintRevisionId(): string {
	return `rev_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** All revisions for one routine, newest first. */
export async function listRevisions(jobId: string): Promise<CronJobRevision[]> {
	const all = await readRevisions();
	return [...(all[jobId] ?? [])].sort((a, b) => b.revision - a.revision || b.createdAt - a.createdAt);
}

/** Append a revision and cap the history. Callers allocate the revision id/number. */
export async function appendRevision(revision: CronJobRevision): Promise<void> {
	const path = revisionsPath();
	await withKeyedLock(`cron-revisions:${path}`, async () => {
		const all = await readRevisions(path);
		const existing = all[revision.jobId] ?? [];
		const next = [revision, ...existing]
			.sort((a, b) => b.revision - a.revision || b.createdAt - a.createdAt)
			.slice(0, MAX_REVISIONS_PER_JOB);
		all[revision.jobId] = next;
		await writeRevisions(path, all);
	});
}

/** Resolve one revision; returns undefined when it was trimmed or never existed. */
export async function getRevision(jobId: string, revisionId: string): Promise<CronJobRevision | undefined> {
	const all = await readRevisions();
	return (all[jobId] ?? []).find((revision) => revision.id === revisionId);
}

/** Remove a routine's history (used when a job is deleted by an explicit reset). */
export async function deleteRevisions(jobId: string): Promise<void> {
	const path = revisionsPath();
	await withKeyedLock(`cron-revisions:${path}`, async () => {
		const all = await readRevisions(path);
		delete all[jobId];
		await writeRevisions(path, all);
	});
}
