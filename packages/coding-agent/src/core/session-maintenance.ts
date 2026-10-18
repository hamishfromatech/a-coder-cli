import { existsSync, mkdirSync, readdirSync, renameSync, statSync } from "node:fs";
import { basename, join, resolve, sep } from "node:path";
import { getSessionsDir } from "../config.ts";
import { type SessionInfo, SessionManager } from "./session-manager.ts";

/**
 * Session-store maintenance: size accounting, recoverable archiving, and
 * transcript search.
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
				if (entry.name === ".trash") continue;
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
	renameSync(target, trashPath);
	return { trashPath };
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
