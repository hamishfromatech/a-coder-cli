import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	statSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { getSessionsDir } from "../config.ts";
import { withFileLockRetrySync } from "../utils/file-retry.ts";
import {
	type FileEntry,
	parseSessionEntries,
	type SessionEntry,
	type SessionHeader,
	type SessionInfo,
	SessionManager,
} from "./session-manager.ts";

/**
 * Session-store maintenance: size accounting, recoverable archiving, transcript
 * search, and in-place compaction of oversized session files.
 *
 * The store is append-only JSONL under `<agentDir>/sessions/<project>/`.
 * Nothing ever deletes from it, so it grows without bound; and the resume
 * picker filters titles/first messages only, so finding "the session where I
 * fixed the proxy" needs a content search.
 */

export interface SessionStoreStats {
	/** Root sessions directory. */
	dir: string;
	count: number;
	totalBytes: number;
	/** Largest sessions, descending. */
	largest: Array<{ path: string; bytes: number }>;
	/** Newest and oldest by modification time. */
	newest?: { path: string; modified: Date };
	oldest?: { path: string; modified: Date };
}

/** Every stored session file, excluding the archive (`<dir>/.trash`). */
export function listSessionFiles(dir: string = getSessionsDir()): string[] {
	const out: string[] = [];
	const walk = (current: string) => {
		let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
		try {
			entries = readdirSync(current, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const path = join(current, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === ".trash" || entry.name === ".office") continue;
				walk(path);
			} else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
				out.push(path);
			}
		}
	};
	walk(resolve(dir));
	return out;
}

export function getSessionStoreStats(dir: string = getSessionsDir()): SessionStoreStats {
	const files = listSessionFiles(dir);
	let totalBytes = 0;
	let newest: SessionStoreStats["newest"];
	let oldest: SessionStoreStats["oldest"];
	const sized: Array<{ path: string; bytes: number }> = [];

	for (const path of files) {
		let stat: ReturnType<typeof statSync>;
		try {
			stat = statSync(path);
		} catch {
			continue;
		}
		totalBytes += stat.size;
		sized.push({ path, bytes: stat.size });
		if (!newest || stat.mtime > newest.modified) newest = { path, modified: stat.mtime };
		if (!oldest || stat.mtime < oldest.modified) oldest = { path, modified: stat.mtime };
	}

	sized.sort((a, b) => b.bytes - a.bytes);
	return {
		dir: resolve(dir),
		count: files.length,
		totalBytes,
		largest: sized.slice(0, 5),
		newest,
		oldest,
	};
}

export interface ArchiveOptions {
	sessionsDir?: string;
	/** The open session: archiving it would pull the file out from under the runtime. */
	activePath?: string;
}

/**
 * Move a stored session into `<sessions>/.trash` (recoverable — this is not an
 * unlink). Refuses paths outside the store and the open session.
 */
export function archiveSessionFile(path: string, options: ArchiveOptions = {}): { trashPath: string } {
	const sessionsDir = resolve(options.sessionsDir ?? getSessionsDir());
	const target = resolve(path);
	if (options.activePath && resolve(options.activePath) === target) {
		throw new Error("Cannot archive the open session");
	}
	if (target !== sessionsDir && !target.startsWith(`${sessionsDir}${sep}`)) {
		throw new Error("Not a stored session file");
	}
	if (target.startsWith(`${join(sessionsDir, ".trash")}${sep}`)) {
		throw new Error("Session is already archived");
	}
	if (!existsSync(target)) {
		throw new Error(`Unknown session: ${path}`);
	}
	const trashDir = join(sessionsDir, ".trash");
	mkdirSync(trashDir, { recursive: true });
	const trashPath = join(trashDir, `${basename(target)}.${Date.now()}`);
	withFileLockRetrySync(() => renameSync(target, trashPath));
	return { trashPath };
}

// ============================================================================
// Compaction
// ============================================================================

/**
 * Files below this size are not worth a rewrite; compaction targets sessions
 * that grew large because of redundant metadata entries.
 */
export const DEFAULT_COMPACT_MIN_BYTES = 256 * 1024;

/** Why an entry is redundant. Every reason is a non-context, last-wins record. */
export type CompactionDropReason = "superseded-label" | "superseded-session-info" | "superseded-file-history";

export interface DroppedSessionEntry {
	id: string;
	type: SessionEntry["type"];
	reason: CompactionDropReason;
	/** Entry that makes this one redundant. */
	supersededBy: string;
}

export interface CompactionSelection {
	/** Entries to keep, in original file order, re-chained after removals. */
	kept: FileEntry[];
	dropped: DroppedSessionEntry[];
	/** Serialized JSONL of `kept`. */
	bytes: string;
}

interface EntryStructure {
	/** Pre-order index per entry. */
	tin: Map<string, number>;
	/** Highest pre-order index in the entry's subtree. */
	tout: Map<string, number>;
	/** Number of leaves in the entry's subtree. */
	leafCount: Map<string, number>;
	/** False when ids are duplicated, parents dangle, or the graph has a cycle. */
	valid: boolean;
}

/**
 * Map the tree shape without recursion (session files can have very long
 * chains). Intervals plus per-subtree leaf counts let us prove that every leaf
 * reaching one entry also reaches a later one.
 */
function describeEntryStructure(body: SessionEntry[]): EntryStructure {
	const byId = new Map<string, SessionEntry>();
	const children = new Map<string, string[]>();
	const roots: string[] = [];
	let valid = true;

	for (const entry of body) {
		if (byId.has(entry.id)) {
			valid = false;
			continue;
		}
		byId.set(entry.id, entry);
	}

	for (const entry of body) {
		if (byId.get(entry.id) !== entry) continue; // duplicate id
		if (entry.parentId === null || entry.parentId === entry.id) {
			roots.push(entry.id);
			continue;
		}
		if (!byId.has(entry.parentId)) {
			valid = false; // orphan; leave the shape alone
			continue;
		}
		const siblings = children.get(entry.parentId);
		if (siblings) siblings.push(entry.id);
		else children.set(entry.parentId, [entry.id]);
	}

	const tin = new Map<string, number>();
	const tout = new Map<string, number>();
	const leafCount = new Map<string, number>();
	let clock = 0;
	let visited = 0;
	const stack: Array<{ id: string; expanded: boolean }> = [];
	for (let i = roots.length - 1; i >= 0; i--) stack.push({ id: roots[i], expanded: false });

	while (stack.length > 0) {
		const frame = stack.pop()!;
		const kids = children.get(frame.id) ?? [];
		if (!frame.expanded) {
			tin.set(frame.id, clock++);
			visited++;
			stack.push({ id: frame.id, expanded: true });
			for (let i = kids.length - 1; i >= 0; i--) stack.push({ id: kids[i], expanded: false });
			continue;
		}
		tout.set(frame.id, clock - 1);
		let descendants = 0;
		for (const kid of kids) descendants += leafCount.get(kid) ?? 0;
		leafCount.set(frame.id, kids.length === 0 ? 1 : descendants);
	}

	// Unreachable entries mean a cycle; refuse to touch the shape.
	if (visited !== byId.size) valid = false;

	return { tin, tout, leafCount, valid };
}

/** True when `candidate` sits in `entry`'s subtree and covers the same leaves. */
function coversSameLeaves(structure: EntryStructure, entry: string, candidate: string): boolean {
	const entryIn = structure.tin.get(entry);
	const entryOut = structure.tout.get(entry);
	const candidateIn = structure.tin.get(candidate);
	const candidateOut = structure.tout.get(candidate);
	if (entryIn === undefined || entryOut === undefined) return false;
	if (candidateIn === undefined || candidateOut === undefined) return false;
	if (candidateIn < entryIn || candidateOut > entryOut) return false;
	return structure.leafCount.get(candidate) === structure.leafCount.get(entry);
}

/** Canonical JSONL for a session file (one entry per line). */
export function serializeSessionEntries(entries: FileEntry[]): string {
	return entries.map((entry) => `${JSON.stringify(entry)}\n`).join("");
}

/**
 * Pick entries that can be removed without changing what the session means.
 *
 * Only three entry types are ever eligible, and each is redundant because the
 * reader already ignores everything but the last record for a key:
 *
 * - `label`: resolved per target in file order, last wins.
 * - `session_info`: the session name comes from the last entry.
 * - `file_history_snapshot`: rewind takes the last snapshot per messageId on
 *   the branch, so an earlier one only goes when a later one lies on every
 *   path through it.
 *
 * Anything that feeds branching, LLM context, model/thinking state, or
 * extension state is never dropped. Entries a compaction summary keeps
 * (`firstKeptEntryId`) and entries a retained label points at are protected
 * too, so context assembly and the tree view stay identical.
 */
export function selectCompactionEntries(entries: FileEntry[]): CompactionSelection {
	const header = entries.find((entry): entry is SessionHeader => entry.type === "session");
	const body = entries.filter((entry): entry is SessionEntry => entry.type !== "session");
	const unchanged: CompactionSelection = { kept: entries, dropped: [], bytes: serializeSessionEntries(entries) };

	if (!header || body.length === 0) return unchanged;

	const byId = new Map<string, SessionEntry>();
	for (const entry of body) byId.set(entry.id, entry);
	const structure = describeEntryStructure(body);
	if (!structure.valid) return unchanged;

	const candidates = new Map<string, DroppedSessionEntry>();
	const protectedIds = new Set<string>();

	// Last-wins keys, in file order.
	const lastLabelIndexByTarget = new Map<string, number>();
	let lastSessionInfoIndex = -1;
	const lastSnapshotIndexByMessageId = new Map<string, number>();
	for (let i = 0; i < body.length; i++) {
		const entry = body[i];
		if (entry.type === "label") lastLabelIndexByTarget.set(entry.targetId, i);
		else if (entry.type === "session_info") lastSessionInfoIndex = i;
		else if (entry.type === "file_history_snapshot") lastSnapshotIndexByMessageId.set(entry.snapshot.messageId, i);
	}

	for (let i = 0; i < body.length; i++) {
		const entry = body[i];
		if (entry.type === "label") {
			const last = lastLabelIndexByTarget.get(entry.targetId) ?? i;
			if (last > i) {
				candidates.set(entry.id, {
					id: entry.id,
					type: entry.type,
					reason: "superseded-label",
					supersededBy: body[last].id,
				});
			}
			continue;
		}
		if (entry.type === "session_info") {
			if (lastSessionInfoIndex > i) {
				candidates.set(entry.id, {
					id: entry.id,
					type: entry.type,
					reason: "superseded-session-info",
					supersededBy: body[lastSessionInfoIndex].id,
				});
			}
			continue;
		}
		if (entry.type === "file_history_snapshot") {
			const last = lastSnapshotIndexByMessageId.get(entry.snapshot.messageId) ?? i;
			if (last > i && coversSameLeaves(structure, entry.id, body[last].id)) {
				candidates.set(entry.id, {
					id: entry.id,
					type: entry.type,
					reason: "superseded-file-history",
					supersededBy: body[last].id,
				});
			}
			continue;
		}
		if (entry.type === "compaction" && entry.firstKeptEntryId) protectedIds.add(entry.firstKeptEntryId);
	}

	// Shrink the candidate set until retained labels and compaction summaries
	// keep every entry they reference.
	let pruned = candidates.size > 0;
	while (pruned) {
		pruned = false;
		for (const id of protectedIds) {
			if (candidates.delete(id)) pruned = true;
		}
		for (const entry of body) {
			if (entry.type !== "label" || candidates.has(entry.id)) continue;
			protectedIds.add(entry.targetId);
		}
	}

	if (candidates.size === 0) return unchanged;

	const droppedIds = new Set(candidates.keys());
	const keptParent = (parentId: string | null): string | null => {
		let current = parentId;
		const seen = new Set<string>();
		while (current !== null && droppedIds.has(current)) {
			if (seen.has(current)) return null;
			seen.add(current);
			const parent = byId.get(current)?.parentId ?? null;
			current = parent === current ? null : parent;
		}
		return current;
	};

	const kept: FileEntry[] = [];
	for (const entry of entries) {
		if (entry.type === "session") {
			kept.push(entry);
			continue;
		}
		if (droppedIds.has(entry.id)) continue;
		const parentId = keptParent(entry.parentId);
		kept.push(parentId === entry.parentId ? entry : { ...entry, parentId });
	}

	return { kept, dropped: [...candidates.values()], bytes: serializeSessionEntries(kept) };
}

/** Human-readable byte size (1024-based, one decimal below 10 units). */
export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes) || bytes < 0) return "?";
	if (bytes < 1024) return `${Math.round(bytes)} B`;
	const units = ["KB", "MB", "GB", "TB"];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
}

export interface SessionSearchHit {
	session: SessionInfo;
	/** Text around the first match, whitespace collapsed. */
	snippet: string;
	/** Number of matches in the session's message text (scan-capped). */
	matches: number;
}

export interface SessionSearchOptions {
	limit?: number;
	/** Injectable for tests; defaults to SessionManager.listAll(). */
	listSessions?: () => Promise<SessionInfo[]>;
}

const SNIPPET_BEFORE = 48;
const SNIPPET_AFTER = 96;

function makeSnippet(text: string, index: number, queryLength: number): string {
	const start = Math.max(0, index - SNIPPET_BEFORE);
	const end = Math.min(text.length, index + queryLength + SNIPPET_AFTER);
	const body = text.slice(start, end).replace(/\s+/g, " ").trim();
	return `${start > 0 ? "…" : ""}${body}${end < text.length ? "…" : ""}`;
}

/**
 * Search stored transcripts for a substring (case-insensitive). Matches the
 * user-set name, the working directory, or any message text. Sessions whose
 * name matches rank first, then by recency.
 */
export async function searchSessions(query: string, options: SessionSearchOptions = {}): Promise<SessionSearchHit[]> {
	const trimmed = query.trim();
	if (!trimmed) return [];
	const needle = trimmed.toLowerCase();
	const limit = options.limit ?? 40;
	const list = options.listSessions ?? (() => SessionManager.listAll());

	let sessions: SessionInfo[];
	try {
		sessions = await list();
	} catch {
		return [];
	}

	const hits: SessionSearchHit[] = [];
	for (const session of sessions) {
		const name = (session.name ?? "").toLowerCase();
		const cwd = (session.cwd ?? "").toLowerCase();
		const text = session.allMessagesText ?? "";
		const lowerText = text.toLowerCase();

		const nameMatch = name.includes(needle);
		const cwdMatch = cwd.includes(needle);
		const index = lowerText.indexOf(needle);
		if (!nameMatch && !cwdMatch && index < 0) continue;

		let matches = 0;
		let scan = index;
		while (scan >= 0 && matches < 1000) {
			matches += 1;
			scan = lowerText.indexOf(needle, scan + needle.length);
		}

		hits.push({
			session,
			snippet:
				index >= 0
					? makeSnippet(text, index, needle.length)
					: nameMatch
						? `${session.name ?? ""}${session.cwd ? ` · ${session.cwd}` : ""}`
						: session.cwd,
			matches,
		});
	}

	hits.sort((a, b) => {
		const aName = (a.session.name ?? "").toLowerCase().includes(needle) ? 1 : 0;
		const bName = (b.session.name ?? "").toLowerCase().includes(needle) ? 1 : 0;
		if (aName !== bName) return bName - aName;
		return b.session.modified.getTime() - a.session.modified.getTime();
	});

	return hits.slice(0, limit);
}

// ============================================================================
// Compaction: file and store level
// ============================================================================

/** Why a file was left untouched. Absent means it was (or would be) rewritten. */
export type CompactionSkipReason =
	| "missing"
	| "active-session"
	| "not-a-session"
	| "below-threshold"
	| "no-savings"
	| "changed";

export interface CompactFileResult {
	path: string;
	bytesBefore: number;
	/** Measured after a rewrite, projected in a dry run. */
	bytesAfter: number;
	entriesBefore: number;
	entriesAfter: number;
	dropped: DroppedSessionEntry[];
	/** Malformed lines the rewrite discards (already invisible to every reader). */
	droppedLines: number;
	applied: boolean;
	/** Recoverable copy of the original, written before the swap. */
	trashPath?: string;
	skipped?: CompactionSkipReason;
}

export interface CompactFileOptions {
	sessionsDir?: string;
	/** The open session: compaction would pull the file out from under the runtime. */
	activePath?: string;
	/** Extra paths to treat as live. */
	skipPaths?: ReadonlyArray<string>;
	minBytes?: number;
	/** Write the rewrite. Without this the call only reports. */
	apply?: boolean;
}

/**
 * Compact one session file: drop provably redundant entries, then atomically
 * swap in the rewritten file. The original is copied into `<sessions>/.trash`
 * first, so every compaction stays recoverable.
 *
 * A live runtime is never disturbed: the open session is refused, and a file
 * that changed between reading and swapping is left alone.
 */
export function compactSessionFile(path: string, options: CompactFileOptions = {}): CompactFileResult {
	const sessionsDir = resolve(options.sessionsDir ?? getSessionsDir());
	const target = resolve(path);
	if (target !== sessionsDir && !target.startsWith(`${sessionsDir}${sep}`)) {
		throw new Error("Not a stored session file");
	}
	if (target.startsWith(`${join(sessionsDir, ".trash")}${sep}`)) {
		throw new Error("Session is already archived");
	}

	const empty: CompactFileResult = {
		path: target,
		bytesBefore: 0,
		bytesAfter: 0,
		entriesBefore: 0,
		entriesAfter: 0,
		dropped: [],
		droppedLines: 0,
		applied: false,
	};

	const activePath = options.activePath ? resolve(options.activePath) : undefined;
	const skipPaths = new Set((options.skipPaths ?? []).map((entry) => resolve(entry)));
	if (activePath === target || skipPaths.has(target)) return { ...empty, skipped: "active-session" };
	if (!existsSync(target)) return { ...empty, skipped: "missing" };

	let before: ReturnType<typeof statSync>;
	try {
		before = statSync(target);
	} catch {
		return { ...empty, skipped: "missing" };
	}
	if (before.size < (options.minBytes ?? DEFAULT_COMPACT_MIN_BYTES)) {
		return { ...empty, bytesBefore: before.size, skipped: "below-threshold" };
	}

	const content = readFileSync(target, "utf8");
	const entries = parseSessionEntries(content);
	const header = entries[0];
	if (!header || header.type !== "session" || typeof header.id !== "string") {
		return { ...empty, bytesBefore: before.size, skipped: "not-a-session" };
	}

	const selection = selectCompactionEntries(entries);
	const projectedBytes = Buffer.byteLength(selection.bytes, "utf8");
	const result: CompactFileResult = {
		path: target,
		bytesBefore: before.size,
		bytesAfter: selection.dropped.length > 0 ? projectedBytes : before.size,
		entriesBefore: entries.length,
		entriesAfter: selection.kept.length,
		dropped: selection.dropped,
		droppedLines: selection.dropped.length,
		applied: false,
	};

	if (selection.dropped.length === 0) return { ...result, skipped: "no-savings" };
	if (projectedBytes >= before.size) return { ...result, skipped: "no-savings" };
	if (!options.apply) return result;

	// Refuse to swap a file a live runtime appended to while we were reading.
	const after = statSync(target);
	if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) return { ...result, skipped: "changed" };

	const trashDir = join(sessionsDir, ".trash");
	mkdirSync(trashDir, { recursive: true });
	const trashPath = join(trashDir, `${basename(target)}.${Date.now()}`);
	withFileLockRetrySync(() => writeFileSync(trashPath, content));

	// Same directory, so the rename is atomic on every supported platform.
	const tempPath = join(dirname(target), `.${basename(target)}.${process.pid}.compact.tmp`);
	try {
		withFileLockRetrySync(() => writeFileSync(tempPath, selection.bytes));
		withFileLockRetrySync(() => renameSync(tempPath, target));
	} catch (error) {
		if (existsSync(tempPath)) unlinkSync(tempPath);
		throw error;
	}

	return { ...result, bytesAfter: projectedBytes, applied: true, trashPath };
}

export type CompactStoreOptions = CompactFileOptions;

export interface CompactionReport {
	dir: string;
	/** True unless `apply` was set; the report is identical either way. */
	dryRun: boolean;
	/** Session files examined. */
	scanned: number;
	/** Files with removable entries. */
	candidates: number;
	/** Candidates plus notably skipped files (active, changed, unreadable). */
	files: CompactFileResult[];
	bytesBefore: number;
	bytesAfter: number;
	bytesSaved: number;
	entriesDropped: number;
	trashPaths: string[];
}

/**
 * Compact every oversized session file in the store. Dry run by default.
 * The open session is skipped, and nothing is ever deleted: each rewritten
 * file leaves its original in `<sessions>/.trash`.
 */
export function compactSessionStore(options: CompactStoreOptions = {}): CompactionReport {
	const dir = resolve(options.sessionsDir ?? getSessionsDir());
	const files = listSessionFiles(dir);
	const results: CompactFileResult[] = [];
	const report: CompactionReport = {
		dir,
		dryRun: options.apply !== true,
		scanned: files.length,
		candidates: 0,
		files: [],
		bytesBefore: 0,
		bytesAfter: 0,
		bytesSaved: 0,
		entriesDropped: 0,
		trashPaths: [],
	};

	for (const path of files) {
		const result = compactSessionFile(path, { ...options, sessionsDir: dir });
		if (result.applied) report.trashPaths.push(result.trashPath ?? "");
		if (result.dropped.length > 0) {
			report.candidates++;
			report.bytesBefore += result.bytesBefore;
			report.bytesAfter += result.bytesAfter;
			report.entriesDropped += result.dropped.length;
			results.push(result);
			continue;
		}
		if (result.skipped && result.skipped !== "below-threshold" && result.skipped !== "no-savings") {
			results.push(result);
		}
	}

	report.bytesSaved = Math.max(0, report.bytesBefore - report.bytesAfter);
	report.files = results.sort((a, b) => b.bytesBefore - a.bytesBefore);
	report.trashPaths = report.trashPaths.filter(Boolean);
	return report;
}
