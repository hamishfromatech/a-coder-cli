/**
 * Atomic write for cron state files (`jobs.json`, `runs.json`,
 * `revisions.json`): write a tmp sibling, then rename it into place.
 *
 * Both steps retry transient Windows file locks (AV/indexers hold the tmp or
 * target file briefly), and the tmp file is removed when the rename never
 * lands so failed writes do not litter the cron directory.
 */

import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { withFileLockRetry } from "../../utils/file-retry.ts";

export async function atomicWrite(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
	try {
		await withFileLockRetry(() => writeFile(tmp, content, "utf-8"));
		await withFileLockRetry(() => rename(tmp, path));
	} catch (error) {
		await unlink(tmp).catch(() => {});
		throw error;
	}
}
