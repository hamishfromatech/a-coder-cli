/**
 * Persistent task graph — one list per session, stored on disk.
 *
 * Ports easy-agent's taskStore (itself modeled on Claude Code's Task V2):
 * tasks survive restarts and conversation clears, use stable high-water-mark
 * ids, and support a dependency graph (`blocks`/`blockedBy` maintained
 * bidirectionally by the store so the model only has to name one side).
 *
 * Layout (per task list):
 *
 *   ~/.a-coder/cli/tasks/<taskListId>/
 *     1.json
 *     2.json
 *     .highwatermark   <-- max id ever assigned, survives deletes/reset
 *     .lock            <-- proper-lockfile target for list-level ops
 *
 * One file per task gives atomic per-task writes without reading the whole
 * list, human-editable state, and per-task locks so independent updates
 * don't serialize. `proper-lockfile` guards list-level critical sections
 * (create/reset) so id allocation is serialized even across processes.
 */

import type { Dirent } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import * as path from "node:path";
import lockfile from "proper-lockfile";
import { getTasksRoot } from "../../config.ts";

export const TASK_STATUSES = ["pending", "in_progress", "completed"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export interface Task {
	/** Incrementing numeric id as string, stable across restarts. */
	id: string;
	/** Imperative one-liner, e.g. "Run the tests". */
	subject: string;
	/** Detailed description of the work. */
	description: string;
	/** Present-continuous form shown in the spinner while in_progress. */
	activeForm?: string;
	/** Agent/teammate name that owns the task. Reserved for Agent Teams. */
	owner?: string;
	status: TaskStatus;
	/** ISO timestamp stamped when the task transitioned into completed. */
	completedAt?: string;
	/** Task ids this task blocks (downstream). */
	blocks: string[];
	/** Task ids that block this task (upstream). */
	blockedBy: string[];
	/** Arbitrary tool-specific metadata. */
	metadata?: Record<string, unknown>;
	/** True when loaded from the archive history (archive.jsonl), not the live dir. */
	archived?: boolean;
}

const HIGH_WATER_MARK_FILE = ".highwatermark";
const LOCK_FILE = ".lock";

/**
 * Completed-task archival: the N most recent completed tasks stay in the live
 * directory (full snapshots every tool result); older completed ones move to
 * archive.jsonl — read-only history. Keeps graphs bounded for long sessions.
 */
export const VISIBLE_COMPLETED_LIMIT = 15;
export const ARCHIVE_FILE = "archive.jsonl";

// ~2.6s worst-case wait so concurrent callers queue rather than error out.
const LOCK_OPTIONS = {
	retries: {
		retries: 30,
		minTimeout: 5,
		maxTimeout: 100,
	},
};

// ─── Path helpers ──────────────────────────────────────────────────

/**
 * Restrict taskListId / taskId components to `[A-Za-z0-9_-]` — anything else
 * becomes `-`. Blocks `../` traversal and arbitrary symlink targets the model
 * might dream up when it sees the raw session id.
 */
export function sanitizePathComponent(input: string): string {
	return input.replace(/[^A-Za-z0-9_-]/g, "-");
}

/** Resolve a session id to its task-list id (1-to-1). */
export function getTaskListId(sessionId: string): string {
	return sessionId || "default";
}

export function getTasksDir(taskListId: string): string {
	return path.join(getTasksRoot(), sanitizePathComponent(taskListId));
}

export function getTaskPath(taskListId: string, taskId: string): string {
	return path.join(getTasksDir(taskListId), `${sanitizePathComponent(taskId)}.json`);
}

async function ensureTasksDir(taskListId: string): Promise<void> {
	await mkdir(getTasksDir(taskListId), { recursive: true });
}

/**
 * Ensure the list-level lock file exists. proper-lockfile refuses to lock a
 * path that doesn't exist, so touch an empty sentinel first. The `wx` flag
 * makes creation idempotent — the second writer's EEXIST is benign.
 */
async function ensureTaskListLockFile(taskListId: string): Promise<string> {
	await ensureTasksDir(taskListId);
	const lockPath = path.join(getTasksDir(taskListId), LOCK_FILE);
	try {
		await writeFile(lockPath, "", { flag: "wx" });
	} catch {
		// Already exists — fine.
	}
	return lockPath;
}

// ─── High water mark ───────────────────────────────────────────────

function getHighWaterMarkPath(taskListId: string): string {
	return path.join(getTasksDir(taskListId), HIGH_WATER_MARK_FILE);
}

async function readHighWaterMark(taskListId: string): Promise<number> {
	try {
		const content = (await readFile(getHighWaterMarkPath(taskListId), "utf-8")).trim();
		const value = Number.parseInt(content, 10);
		return Number.isNaN(value) ? 0 : value;
	} catch {
		return 0;
	}
}

async function writeHighWaterMark(taskListId: string, value: number): Promise<void> {
	await writeFile(getHighWaterMarkPath(taskListId), String(value));
}

// ─── Archive (completed-task history) ──────────────────────────────

function getArchivePath(taskListId: string): string {
	return path.join(getTasksDir(taskListId), ARCHIVE_FILE);
}

/** Parse every archive line; malformed lines are skipped. */
async function readArchive(taskListId: string): Promise<Task[]> {
	let content: string;
	try {
		content = await readFile(getArchivePath(taskListId), "utf-8");
	} catch {
		return [];
	}
	const tasks: Task[] = [];
	for (const line of content.split("\n")) {
		if (!line.trim()) continue;
		const parsed = parseTask(JSON.parse(line));
		if (parsed) tasks.push({ ...parsed, archived: true });
	}
	return tasks;
}

async function writeArchiveLines(taskListId: string, tasks: readonly Task[]): Promise<void> {
	if (tasks.length === 0) {
		// Nothing left in history: remove the file rather than keep an empty one.
		await unlink(getArchivePath(taskListId)).catch(() => {});
		return;
	}
	const body = `${tasks.map((t) => JSON.stringify({ ...t })).join("\n")}\n`;
	await writeFile(getArchivePath(taskListId), body);
}

async function appendArchiveTasks(taskListId: string, tasks: readonly Task[]): Promise<void> {
	if (tasks.length === 0) return;
	const existing = await readArchive(taskListId);
	const merged = [...existing.filter((t) => t.id !== undefined), ...tasks.map((t) => ({ ...t, archived: undefined }))];
	// Order by numeric id ascending so the archive reads chronologically.
	merged.sort((a, b) => Number(a.id) - Number(b.id));
	await writeArchiveLines(taskListId, merged);
}

async function removeFromArchive(taskListId: string, taskId: string): Promise<boolean> {
	const archived = await readArchive(taskListId);
	if (!archived.some((t) => t.id === taskId)) return false;
	await writeArchiveLines(
		taskListId,
		archived.filter((t) => t.id !== taskId),
	);
	return true;
}

/** Drop `taskId` from every archived task's blocks/blockedBy (delete-cascade into history). */
async function stripArchivedReferences(taskListId: string, taskId: string): Promise<void> {
	const archived = await readArchive(taskListId);
	let changed = false;
	const next = archived.map((t) => {
		const blocks = t.blocks.filter((id) => id !== taskId);
		const blockedBy = t.blockedBy.filter((id) => id !== taskId);
		if (blocks.length !== t.blocks.length || blockedBy.length !== t.blockedBy.length) {
			changed = true;
			return { ...t, blocks, blockedBy };
		}
		return t;
	});
	if (changed) {
		await writeArchiveLines(taskListId, next);
	}
}

async function findHighestTaskIdFromFiles(taskListId: string): Promise<number> {
	let files: string[];
	try {
		files = await readdir(getTasksDir(taskListId));
	} catch {
		return 0;
	}
	let highest = 0;
	for (const file of files) {
		if (!file.endsWith(".json")) continue;
		const parsed = Number.parseInt(file.replace(".json", ""), 10);
		if (!Number.isNaN(parsed) && parsed > highest) {
			highest = parsed;
		}
	}
	return highest;
}

async function findHighestTaskId(taskListId: string): Promise<number> {
	const [fromFiles, fromMark] = await Promise.all([
		findHighestTaskIdFromFiles(taskListId),
		readHighWaterMark(taskListId),
	]);
	return Math.max(fromFiles, fromMark);
}

// ─── Validation ────────────────────────────────────────────────────

function isTaskStatus(value: unknown): value is TaskStatus {
	return typeof value === "string" && (TASK_STATUSES as readonly string[]).includes(value);
}

export function parseTask(raw: unknown): Task | null {
	if (!raw || typeof raw !== "object") return null;
	const obj = raw as Record<string, unknown>;
	if (typeof obj.id !== "string" || typeof obj.subject !== "string") return null;
	if (typeof obj.description !== "string") return null;
	if (!isTaskStatus(obj.status)) return null;
	const blocks = Array.isArray(obj.blocks) ? obj.blocks.filter((x): x is string => typeof x === "string") : [];
	const blockedBy = Array.isArray(obj.blockedBy)
		? obj.blockedBy.filter((x): x is string => typeof x === "string")
		: [];
	const completedAt =
		typeof obj.completedAt === "string" && !Number.isNaN(Date.parse(obj.completedAt)) ? obj.completedAt : undefined;
	return {
		id: obj.id,
		subject: obj.subject,
		description: obj.description,
		activeForm: typeof obj.activeForm === "string" ? obj.activeForm : undefined,
		owner: typeof obj.owner === "string" ? obj.owner : undefined,
		status: obj.status,
		completedAt,
		blocks,
		blockedBy,
		metadata:
			obj.metadata && typeof obj.metadata === "object" && !Array.isArray(obj.metadata)
				? (obj.metadata as Record<string, unknown>)
				: undefined,
		archived: obj.archived === true ? true : undefined,
	};
}

// ─── Signal (for UI refresh) ───────────────────────────────────────

type TaskListener = (taskListId: string) => void;
const taskListeners = new Set<TaskListener>();

/** Subscribe to in-process task updates. Fires after every mutation. */
export function subscribeTasks(listener: TaskListener): () => void {
	taskListeners.add(listener);
	return () => {
		taskListeners.delete(listener);
	};
}

function notifyTasksUpdated(taskListId: string): void {
	for (const listener of taskListeners) {
		try {
			listener(taskListId);
		} catch {
			// Never let UI subscribers break a mutation.
		}
	}
}

// ─── CRUD ──────────────────────────────────────────────────────────

/** Create a new task. List-level lock so concurrent creators can't collide. */
export async function createTask(taskListId: string, data: Omit<Task, "id">): Promise<string> {
	const lockPath = await ensureTaskListLockFile(taskListId);
	const release = await lockfile.lock(lockPath, LOCK_OPTIONS);
	try {
		const highest = await findHighestTaskId(taskListId);
		const id = String(highest + 1);
		const task: Task = { id, ...data };
		await writeFile(getTaskPath(taskListId, id), JSON.stringify(task, null, 2));
		notifyTasksUpdated(taskListId);
		return id;
	} finally {
		await release();
	}
}

export async function getTask(taskListId: string, taskId: string): Promise<Task | null> {
	try {
		const content = await readFile(getTaskPath(taskListId, taskId), "utf-8");
		return parseTask(JSON.parse(content));
	} catch {
		// Not in the live dir: check the archived history (read-only). Archived
		// ids must stay resolvable — live tasks and the model can reference them.
		const archived = await readArchive(taskListId);
		return archived.find((t) => t.id === taskId) ?? null;
	}
}

export async function listTasks(taskListId: string): Promise<Task[]> {
	let files: string[];
	try {
		files = await readdir(getTasksDir(taskListId));
	} catch {
		return [];
	}
	const ids = files.filter((f) => f.endsWith(".json") && !f.startsWith(".")).map((f) => f.replace(".json", ""));
	const tasks = await Promise.all(ids.map((id) => getTask(taskListId, id)));
	return tasks.filter((t): t is Task => t !== null);
}

/** Live tasks plus archived completed history (each carrying `archived: true`). */
export async function listTasksWithArchive(taskListId: string): Promise<{ live: Task[]; archived: Task[] }> {
	const [live, archived] = await Promise.all([listTasks(taskListId), readArchive(taskListId)]);
	return { live, archived };
}

/** Internal update primitive — caller must already hold the per-task lock. */
async function updateTaskUnsafe(
	taskListId: string,
	taskId: string,
	updates: Partial<Omit<Task, "id">>,
): Promise<Task | null> {
	const existing = await getTask(taskListId, taskId);
	if (!existing) return null;
	const next: Partial<Omit<Task, "id">> = { ...updates };
	// Completion timestamps: stamp on the -> completed transition; clear on reopen.
	if (updates.status === "completed" && existing.status !== "completed") {
		next.completedAt = new Date().toISOString();
	} else if (updates.status && updates.status !== "completed" && existing.status === "completed") {
		next.completedAt = undefined;
	}
	const updated: Task = { ...existing, ...next, id: taskId, archived: undefined };
	await writeFile(getTaskPath(taskListId, taskId), JSON.stringify(updated, null, 2));
	notifyTasksUpdated(taskListId);
	return updated;
}

/** Update a task. Per-task lock isolates concurrent updates to different tasks. */
export async function updateTask(
	taskListId: string,
	taskId: string,
	updates: Partial<Omit<Task, "id">>,
): Promise<Task | null> {
	// Check existence BEFORE locking: proper-lockfile throws if the target path
	// doesn't exist, and we want a clean null for the "already deleted" case.
	const pre = await getTask(taskListId, taskId);
	if (!pre) return null;
	if (pre.archived) {
		throw new Error(
			`Task #${taskId} is archived completed history — archived tasks are read-only. ` +
				"Start a fresh task with task_create instead.",
		);
	}

	const release = await lockfile.lock(getTaskPath(taskListId, taskId), LOCK_OPTIONS);
	try {
		const updated = await updateTaskUnsafe(taskListId, taskId, updates);
		// Completed frontier housekeeping: keep only the most recent
		// completed tasks in the live dir, archive the rest.
		if (updated && updates.status && updates.status !== pre.status) {
			try {
				await archiveOldCompletedTasks(taskListId);
			} catch {
				// Archival is best-effort housekeeping; never fail the mutation.
			}
		}
		return updated;
	} finally {
		await release();
	}
}

/**
 * Delete a task. Records the id in the high water mark first so we never
 * reassign it, then cascades the blocks/blockedBy references in siblings.
 */
/** Drop `taskId` from every LIVE sibling's blocks/blockedBy (delete cascade). */
async function stripLiveReferences(taskListId: string, taskId: string): Promise<void> {
	const siblings = await listTasks(taskListId);
	for (const sibling of siblings) {
		const newBlocks = sibling.blocks.filter((id) => id !== taskId);
		const newBlockedBy = sibling.blockedBy.filter((id) => id !== taskId);
		if (newBlocks.length !== sibling.blocks.length || newBlockedBy.length !== sibling.blockedBy.length) {
			await updateTask(taskListId, sibling.id, {
				blocks: newBlocks,
				blockedBy: newBlockedBy,
			});
		}
	}
}

export async function deleteTask(taskListId: string, taskId: string): Promise<boolean> {
	const numericId = Number.parseInt(taskId, 10);
	if (!Number.isNaN(numericId)) {
		const mark = await readHighWaterMark(taskListId);
		if (numericId > mark) {
			await writeHighWaterMark(taskListId, numericId);
		}
	}

	try {
		await unlink(getTaskPath(taskListId, taskId));
		// Cascade: remove references to the deleted task in every live sibling.
		await stripLiveReferences(taskListId, taskId);
		// Cascade into archived history rows too (read-only, so rewrite lines).
		await stripArchivedReferences(taskListId, taskId);
		notifyTasksUpdated(taskListId);
		return true;
	} catch (error: unknown) {
		const err = error as NodeJS.ErrnoException;
		if (err?.code !== "ENOENT") throw error;
		// Not a live file: the task may be archived history — deleting removes
		// the row from the archive outright.
		const removed = await removeFromArchive(taskListId, taskId).catch(() => false);
		if (!removed) return false;
		// A live sibling may still reference the removed archived id.
		await stripLiveReferences(taskListId, taskId);
		await stripArchivedReferences(taskListId, taskId).catch(() => {});
		notifyTasksUpdated(taskListId);
		return true;
	}
}

/**
 * Bidirectional dependency link: `from` blocks `to`. We always update both
 * sides so the graph stays consistent even if the model only names one side.
 * Duplicate entries are a no-op.
 */
export async function blockTask(taskListId: string, fromTaskId: string, toTaskId: string): Promise<boolean> {
	const [from, to] = await Promise.all([getTask(taskListId, fromTaskId), getTask(taskListId, toTaskId)]);
	if (!from || !to) return false;

	if (!from.blocks.includes(toTaskId)) {
		await updateTask(taskListId, fromTaskId, { blocks: [...from.blocks, toTaskId] });
	}
	if (!to.blockedBy.includes(fromTaskId)) {
		await updateTask(taskListId, toTaskId, { blockedBy: [...to.blockedBy, fromTaskId] });
	}
	return true;
}

/**
 * Reset a task list: delete every task file, but remember the highest id ever
 * assigned so future creates don't reuse a stale id. Explicit only (`/tasks
 * reset`) — never auto-reset on conversation clears.
 */
export async function resetTaskList(taskListId: string): Promise<void> {
	const lockPath = await ensureTaskListLockFile(taskListId);
	const release = await lockfile.lock(lockPath, LOCK_OPTIONS);
	try {
		const current = await findHighestTaskIdFromFiles(taskListId);
		if (current > 0) {
			const existing = await readHighWaterMark(taskListId);
			if (current > existing) {
				await writeHighWaterMark(taskListId, current);
			}
		}

		let files: string[];
		try {
			files = await readdir(getTasksDir(taskListId));
		} catch {
			files = [];
		}
		for (const file of files) {
			if (file.endsWith(".json") && !file.startsWith(".")) {
				try {
					await unlink(path.join(getTasksDir(taskListId), file));
				} catch {
					// Another deleter won; fine.
				}
			}
		}
		// Reset clears completed history too.
		await unlink(getArchivePath(taskListId)).catch(() => {});
		notifyTasksUpdated(taskListId);
	} finally {
		await release();
	}
}

// ─── Derived helpers ─────────────────────────────────────

/**
 * Keep only the most recent `VISIBLE_COMPLETED_LIMIT` completed tasks in the
 * live dir; append older ones to the archive (their files are removed and
 * their ids frozen in the high-water mark). Archive order is by numeric id.
 */
export async function archiveOldCompletedTasks(taskListId: string): Promise<number> {
	const lockPath = await ensureTaskListLockFile(taskListId);
	const release = await lockfile.lock(lockPath, LOCK_OPTIONS);
	try {
		const tasks = await listTasks(taskListId);
		const completed = tasks
			.filter((t) => t.status === "completed")
			.sort((a, b) => {
				const at = a.completedAt ? Date.parse(a.completedAt) : NaN;
				const bt = b.completedAt ? Date.parse(b.completedAt) : NaN;
				if (!Number.isNaN(at) || !Number.isNaN(bt)) {
					const aTime = Number.isNaN(at) ? Infinity : at;
					const bTime = Number.isNaN(bt) ? Infinity : bt;
					if (aTime !== bTime) return aTime - bTime;
				}
				return Number(a.id) - Number(b.id);
			});
		if (completed.length <= VISIBLE_COMPLETED_LIMIT) return 0;
		const toArchive = completed.slice(0, completed.length - VISIBLE_COMPLETED_LIMIT);

		// Freeze ids first so a crash between the two steps never reassigns one.
		const mark = await readHighWaterMark(taskListId);
		const maxId = Math.max(...toArchive.map((t) => Number.parseInt(t.id, 10)).filter((n) => !Number.isNaN(n)), 0);
		if (maxId > mark) {
			await writeHighWaterMark(taskListId, maxId);
		}

		await appendArchiveTasks(taskListId, toArchive);
		await Promise.all(toArchive.map((t) => unlink(getTaskPath(taskListId, t.id)).catch(() => {})));
		return toArchive.length;
	} finally {
		await release();
	}
}

// ─── Disk GC (cross-session retention) ─────────────────────

export interface GcResult {
	/** Number of task-list directories removed. */
	removed: number;
	/** Removed directory names (sessions ids). */
	dirs: string[];
}

async function dirFreshness(dir: string): Promise<number> {
	// Newest mtime across the dir itself and every file in it, so a session
	// whose last activity was a task-file MODIFY (which doesn't bump the dir
	// mtime) is not misjudged stale.
	let newest = 0;
	try {
		const entries = await readdir(dir, { withFileTypes: true });
		newest = (await stat(dir)).mtimeMs;
		await Promise.all(
			entries.map(async (entry) => {
				try {
					const m = (await stat(path.join(dir, entry.name))).mtimeMs;
					if (m > newest) newest = m;
				} catch {
					// unreadable entry; ignore
				}
			}),
		);
	} catch {
		return 0;
	}
	return newest;
}

/**
 * Delete task-list directories that have not been touched for
 * `retentionDays`. One task-list dir exists per session; without GC they grow
 * forever. `retentionDays <= 0` disables GC entirely.
 */
export async function gcStaleTaskLists(
	retentionDays: number,
	options?: { exclude?: readonly string[] },
): Promise<GcResult> {
	const dirs: string[] = [];
	if (!retentionDays || retentionDays <= 0) {
		return { removed: 0, dirs };
	}
	const exclude = new Set(options?.exclude ?? []);
	const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
	let rootEntries: Dirent[];
	try {
		rootEntries = await readdir(getTasksRoot(), { withFileTypes: true });
	} catch {
		return { removed: 0, dirs };
	}
	for (const entry of rootEntries) {
		if (!entry.isDirectory() || exclude.has(entry.name)) continue;
		const dirPath = path.join(getTasksRoot(), entry.name);
		const freshness = await dirFreshness(dirPath);
		if (freshness === 0 || freshness > cutoff) continue;
		try {
			await rm(dirPath, { recursive: true, force: true });
			dirs.push(entry.name);
		} catch {
			// Racing another process; leave it for the next GC pass.
		}
	}
	return { removed: dirs.length, dirs };
}

/**
 * A task is "ready" when it's pending and all upstream blockers are completed.
 * This is the predicate the model uses to pick its next task_list entry.
 */
export function isReady(task: Task, tasks: readonly Task[]): boolean {
	if (task.status !== "pending") return false;
	const unresolved = new Set(tasks.filter((t) => t.status !== "completed").map((t) => t.id));
	return task.blockedBy.every((id) => !unresolved.has(id));
}
