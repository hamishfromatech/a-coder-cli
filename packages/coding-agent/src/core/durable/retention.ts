/**
 * Retention for durable run storage.
 *
 * Each scheduled run keeps a JSONL checkpoint directory so it can resume. Finished
 * runs only need their history entry, so their storage is pruned after a retention
 * window; anything still marked running is always kept.
 */

import { readdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

export interface PruneDurableStorageOptions {
	/** Directory holding one subdirectory per run. */
	storageDir: string;
	/** Storage paths that must survive (running or resumable runs). */
	keep: ReadonlySet<string>;
	/** Retention window; older directories are removed. Default seven days. */
	retainMs?: number;
	now?: number;
}

/** Remove expired run directories; returns the removed paths. */
export async function pruneDurableStorage(options: PruneDurableStorageOptions): Promise<string[]> {
	const retainMs = options.retainMs ?? 7 * 24 * 60 * 60 * 1000;
	const cutoff = (options.now ?? Date.now()) - retainMs;
	let entries: string[];
	try {
		entries = await readdir(options.storageDir);
	} catch {
		return [];
	}
	const removed: string[] = [];
	for (const entry of entries) {
		const path = join(options.storageDir, entry);
		if (options.keep.has(path)) continue;
		try {
			const info = await stat(path);
			if (info.mtimeMs > cutoff) continue;
			await rm(path, { recursive: true, force: true });
			removed.push(path);
		} catch {
			// A concurrent prune or a vanished directory is fine.
		}
	}
	return removed;
}
