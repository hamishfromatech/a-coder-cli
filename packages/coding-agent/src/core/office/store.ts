/**
 * Office store — JSON persistence for the Your Office roster.
 *
 * Layout (under the office root, default `~/.a-coder/cli/office/`):
 *
 *   coworkers.json            ← Coworker[]
 *   huddles.json              ← Huddle[]
 *   huddles-data/<id>.log.jsonl   ← append-only message log
 *   huddles-data/<id>.state.json  ← epoch, watermarks, holds, running, stranded
 *   huddles-data/<id>.json        ← legacy combined file (read fallback)
 *   errands.json              ← Errand[]
 *
 * Every writer rewrites the full file atomically (write + rename);
 * read-modify-write sequences are serialized through the keyed mutex, the
 * same tolerance the teams mailboxes use for concurrent writers.
 */

import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getOfficeRoot } from "../../config.ts";
import { withKeyedLock } from "../../utils/async-mutex.ts";
import {
	type Coworker,
	type Errand,
	type Huddle,
	type HuddleData,
	OFFICE_MAX_LOG_MESSAGES,
	type OfficeMessage,
} from "./types.ts";

function coworkersPath(root = getOfficeRoot()): string {
	return join(root, "coworkers.json");
}

function huddlesPath(root = getOfficeRoot()): string {
	return join(root, "huddles.json");
}

function huddleDataPath(huddleId: string, root = getOfficeRoot()): string {
	return join(root, "huddles-data", `${sanitizeId(huddleId)}.json`);
}

function huddleStatePath(huddleId: string, root = getOfficeRoot()): string {
	return join(root, "huddles-data", `${sanitizeId(huddleId)}.state.json`);
}

function huddleLogPath(huddleId: string, root = getOfficeRoot()): string {
	return join(root, "huddles-data", `${sanitizeId(huddleId)}.log.jsonl`);
}

function errandsPath(root = getOfficeRoot()): string {
	return join(root, "errands.json");
}

/** Filesystem-safe slug for storage keys. */
function sanitizeId(id: string): string {
	return id.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
	try {
		const content = await readFile(path, "utf-8");
		return JSON.parse(content) as T;
	} catch {
		return fallback;
	}
}

async function writeJson(path: string, value: unknown): Promise<void> {
	await mkdir(join(path, ".."), { recursive: true });
	const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
	await writeFile(tmp, JSON.stringify(value, null, "\t"), "utf-8");
	await rename(tmp, path);
}

async function withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
	return withKeyedLock(`office:${path}`, fn);
}

// ── coworkers ───────────────────────────────────────────────────────────────

export async function listCoworkers(root?: string): Promise<Coworker[]> {
	return readJson<Coworker[]>(coworkersPath(root), []);
}

export async function saveCoworker(coworker: Coworker, root?: string): Promise<void> {
	const path = coworkersPath(root);
	await withFileLock(path, async () => {
		const list = await readJson<Coworker[]>(path, []);
		const next = list.filter((c) => c.id !== coworker.id);
		next.push(coworker);
		await writeJson(path, next);
	});
}

export async function deleteCoworker(id: string, root?: string): Promise<void> {
	const path = coworkersPath(root);
	await withFileLock(path, async () => {
		const list = await readJson<Coworker[]>(path, []);
		await writeJson(
			path,
			list.filter((c) => c.id !== id),
		);
	});
}

// ── huddles ─────────────────────────────────────────────────────────────────

export async function listHuddles(root?: string): Promise<Huddle[]> {
	return readJson<Huddle[]>(huddlesPath(root), []);
}

export async function saveHuddle(huddle: Huddle, root?: string): Promise<void> {
	const path = huddlesPath(root);
	await withFileLock(path, async () => {
		const list = await readJson<Huddle[]>(path, []);
		const next = list.filter((h) => h.id !== huddle.id);
		next.push(huddle);
		await writeJson(path, next);
	});
}

export async function deleteHuddle(id: string, root?: string): Promise<void> {
	await withFileLock(huddlesPath(root), async () => {
		const list = await readJson<Huddle[]>(huddlesPath(root), []);
		await writeJson(
			huddlesPath(root),
			list.filter((h) => h.id !== id),
		);
	});
	await Promise.all([
		rm(huddleDataPath(id, root), { force: true }),
		rm(huddleStatePath(id, root), { force: true }),
		rm(huddleLogPath(id, root), { force: true }),
	]);
}

export function emptyHuddleData(): HuddleData {
	return { epoch: 0, log: [], watermarks: {}, holds: {} };
}

/** Read a JSONL message log, skipping blank or torn lines (a crash mid-append
 *  can leave at most one malformed tail line). */
async function readLog(path: string): Promise<OfficeMessage[]> {
	try {
		const content = await readFile(path, "utf-8");
		const out: OfficeMessage[] = [];
		for (const line of content.split("\n")) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			try {
				out.push(JSON.parse(trimmed) as OfficeMessage);
			} catch {
				// Skip a partial line rather than losing the rest of the room.
			}
		}
		return out;
	} catch {
		return [];
	}
}

/** Atomically replace a JSONL log (used on first write and after trimming). */
async function writeLog(path: string, log: OfficeMessage[]): Promise<void> {
	await mkdir(join(path, ".."), { recursive: true });
	const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
	const body = log.map((message) => JSON.stringify(message)).join("\n");
	await writeFile(tmp, log.length > 0 ? `${body}\n` : "", "utf-8");
	await rename(tmp, path);
}

/** The state half of a HuddleData record (the log lives in the JSONL file). */
function stateOf(data: HuddleData): Omit<HuddleData, "log"> {
	return {
		epoch: data.epoch,
		watermarks: data.watermarks,
		holds: data.holds,
		running: data.running,
		stranded: data.stranded,
	};
}

function normalizeData(state: Omit<HuddleData, "log"> | null, log: OfficeMessage[]): HuddleData {
	return {
		epoch: typeof state?.epoch === "number" ? state.epoch : 0,
		log,
		watermarks: state?.watermarks ?? {},
		holds: state?.holds ?? {},
		running: state?.running,
		stranded: state?.stranded,
	};
}

/**
 * Load a huddle. New rooms live as `<id>.state.json` + `<id>.log.jsonl`;
 * rooms written by older builds still live in `<id>.json` and are migrated on
 * their next write (the legacy file is left in place as a fallback).
 */
export async function loadHuddleData(huddleId: string, root?: string): Promise<HuddleData> {
	const state = await readJson<Omit<HuddleData, "log"> | null>(huddleStatePath(huddleId, root), null);
	const log = await readLog(huddleLogPath(huddleId, root));
	if (state || log.length > 0) return normalizeData(state, log);

	const legacy = await readJson<HuddleData | null>(huddleDataPath(huddleId, root), null);
	if (!legacy || !Array.isArray(legacy.log)) return emptyHuddleData();
	return normalizeData(legacy, legacy.log);
}

export async function saveHuddleData(huddleId: string, data: HuddleData, root?: string): Promise<void> {
	trimHuddleLog(data);
	await withFileLock(huddleDataPath(huddleId, root), async () => {
		await writeLog(huddleLogPath(huddleId, root), data.log);
		await writeJson(huddleStatePath(huddleId, root), stateOf(data));
	});
}

/**
 * Read-modify-write a huddle under the file lock. The mutator runs
 * synchronously on the loaded record; a thrown mutator leaves storage alone.
 * Appended messages go to the JSONL file; the state file is rewritten (it is
 * small). Trimming rewrites the log once.
 */
export async function updateHuddleData(
	huddleId: string,
	mutate: (data: HuddleData) => void,
	root?: string,
): Promise<HuddleData> {
	return withFileLock(huddleDataPath(huddleId, root), async () => {
		const statePath = huddleStatePath(huddleId, root);
		const logPath = huddleLogPath(huddleId, root);
		const hadState = existsSync(statePath);
		const data = await loadHuddleData(huddleId, root);
		const before = data.log.length;
		mutate(data);
		const overflow = trimHuddleLog(data);

		await mkdir(join(logPath, ".."), { recursive: true });
		if (!hadState || overflow > 0 || !existsSync(logPath)) {
			// First write (including legacy migration) or a trim: rewrite the log.
			await writeLog(logPath, data.log);
		} else if (data.log.length > before) {
			const appended = data.log.slice(before);
			await appendFile(logPath, `${appended.map((message) => JSON.stringify(message)).join("\n")}\n`, "utf-8");
		}
		await writeJson(statePath, stateOf(data));
		return data;
	});
}

/** Drop the oldest log lines past the cap, shifting every index-based
 *  pointer so watermarks and stranded markers keep referring to the same
 *  messages. Returns the number of dropped messages. */
export function trimHuddleLog(data: HuddleData, max = OFFICE_MAX_LOG_MESSAGES): number {
	const overflow = data.log.length - max;
	if (overflow <= 0) return 0;
	data.log = data.log.slice(overflow);
	for (const key of Object.keys(data.watermarks)) {
		data.watermarks[key] = Math.max(0, (data.watermarks[key] ?? 0) - overflow);
	}
	for (const marker of Object.values(data.stranded ?? {})) {
		marker.before = Math.max(0, marker.before - overflow);
	}
	return overflow;
}

/** Append one message + advance the reader's watermark past it. */
export async function appendHuddleMessage(
	huddleId: string,
	message: OfficeMessage,
	readerId?: string,
	root?: string,
): Promise<HuddleData> {
	return updateHuddleData(
		huddleId,
		(data) => {
			data.log.push(message);
			if (readerId) {
				data.watermarks[readerId] = data.log.length;
			}
		},
		root,
	);
}

// ── errands ─────────────────────────────────────────────────────────────────

export async function listErrands(root?: string): Promise<Errand[]> {
	return readJson<Errand[]>(errandsPath(root), []);
}

export async function saveErrand(errand: Errand, root?: string): Promise<void> {
	const path = errandsPath(root);
	await withFileLock(path, async () => {
		const list = await readJson<Errand[]>(path, []);
		const next = list.filter((e) => e.id !== errand.id);
		next.push(errand);
		await writeJson(path, next);
	});
}

export async function deleteErrand(id: string, root?: string): Promise<void> {
	const path = errandsPath(root);
	await withFileLock(path, async () => {
		const list = await readJson<Errand[]>(path, []);
		await writeJson(
			path,
			list.filter((e) => e.id !== id),
		);
	});
}

/** Read-modify-write one errand under the keyed lock. */
export async function updateErrand(
	id: string,
	mutate: (errand: Errand) => void,
	root?: string,
): Promise<Errand | undefined> {
	const path = errandsPath(root);
	return withFileLock(path, async () => {
		const list = await readJson<Errand[]>(path, []);
		const errand = list.find((e) => e.id === id);
		if (!errand) return undefined;
		mutate(errand);
		await writeJson(path, list);
		return errand;
	});
}

/** Remove every record for a coworker (roster delete + DM cleanup). */
export async function deleteCoworkerEverywhere(id: string, dmHuddleId: string, root?: string): Promise<void> {
	await deleteCoworker(id, root);
	await deleteHuddle(dmHuddleId, root);
	const huddles = await listHuddles(root);
	for (const huddle of huddles) {
		if (huddle.members.includes(id)) {
			await saveHuddle({ ...huddle, members: huddle.members.filter((m) => m !== id) }, root);
		}
	}
}
