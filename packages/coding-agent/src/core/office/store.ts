/**
 * Office store — JSON persistence for the Your Office roster.
 *
 * Layout (under the office root, default `~/.a-coder/cli/office/`):
 *
 *   coworkers.json            ← Coworker[]
 *   huddles.json              ← Huddle[]
 *   huddles-data/<id>.json    ← HuddleData (log + watermarks + holds)
 *   errands.json              ← Errand[]
 *
 * Every writer rewrites the full file atomically (write + rename);
 * read-modify-write sequences are serialized through the keyed mutex, the
 * same tolerance the teams mailboxes use for concurrent writers.
 */

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getOfficeRoot } from "../../config.ts";
import { withKeyedLock } from "../../utils/async-mutex.ts";
import type { Coworker, Errand, Huddle, HuddleData, OfficeMessage } from "./types.ts";

function coworkersPath(root = getOfficeRoot()): string {
	return join(root, "coworkers.json");
}

function huddlesPath(root = getOfficeRoot()): string {
	return join(root, "huddles.json");
}

function huddleDataPath(huddleId: string, root = getOfficeRoot()): string {
	return join(root, "huddles-data", `${sanitizeId(huddleId)}.json`);
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
	await rm(huddleDataPath(id, root), { force: true });
}

export function emptyHuddleData(): HuddleData {
	return { epoch: 0, log: [], watermarks: {}, holds: {} };
}

export async function loadHuddleData(huddleId: string, root?: string): Promise<HuddleData> {
	const data = await readJson<HuddleData | null>(huddleDataPath(huddleId, root), null);
	if (!data || !Array.isArray(data.log)) return emptyHuddleData();
	return {
		epoch: typeof data.epoch === "number" ? data.epoch : 0,
		log: data.log,
		watermarks: data.watermarks ?? {},
		holds: data.holds ?? {},
		running: data.running,
		stranded: data.stranded,
	};
}

export async function saveHuddleData(huddleId: string, data: HuddleData, root?: string): Promise<void> {
	await writeJson(huddleDataPath(huddleId, root), data);
}

/**
 * Read-modify-write a huddle's data under the file lock. The mutator runs
 * synchronously on the loaded record; a thrown mutator leaves the file alone.
 */
export async function updateHuddleData(
	huddleId: string,
	mutate: (data: HuddleData) => void,
	root?: string,
): Promise<HuddleData> {
	const path = huddleDataPath(huddleId, root);
	return withFileLock(path, async () => {
		const data = await loadHuddleData(huddleId, root);
		mutate(data);
		await writeJson(path, data);
		return data;
	});
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
