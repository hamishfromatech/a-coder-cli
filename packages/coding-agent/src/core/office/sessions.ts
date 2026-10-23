/**
 * Office session storage.
 *
 * Coworker conversations are agent sessions, but they are not composer
 * sessions. Keep them in a hidden `.office` directory beside the project's
 * normal session files: SessionManager's pickers only read direct `.jsonl`
 * files, so office history stays out of the main session list and resume
 * flow while remaining a normal, resumable session file internally.
 */

import { existsSync, mkdirSync, renameSync, rmSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, join, resolve, sep } from "node:path";
import { getAgentDir } from "../../config.ts";
import { getDefaultSessionDir } from "../session-manager.ts";
import * as store from "./store.ts";

export const OFFICE_SESSION_DIRNAME = ".office";

/** Hidden session directory for one project. */
export function getOfficeSessionDir(cwd: string, agentDir: string = getAgentDir()): string {
	const dir = join(getDefaultSessionDir(cwd, agentDir), OFFICE_SESSION_DIRNAME);
	mkdirSync(dir, { recursive: true });
	return dir;
}

function isUnder(path: string, root: string): boolean {
	const resolved = resolve(path);
	const resolvedRoot = resolve(root);
	return resolved === resolvedRoot || resolved.startsWith(`${resolvedRoot}${sep}`);
}

function isOfficePath(path: string): boolean {
	return resolve(path).split(sep).includes(OFFICE_SESSION_DIRNAME);
}

/**
 * Move registered coworker sessions out of the main session store. This is
 * idempotent and runs at engine startup, before any session picker can read
 * the store. Unregistered legacy sessions cannot be identified safely and are
 * left alone.
 */
export async function migrateLegacyOfficeSessions(agentDir: string = getAgentDir()): Promise<number> {
	const coworkers = await store.listCoworkers().catch(() => []);
	if (coworkers.length === 0) return 0;
	const sessionsRoot = resolve(agentDir, "sessions");
	let moved = 0;

	for (const coworker of coworkers) {
		let changed = false;
		const sessions = { ...coworker.sessions };
		for (const [cwd, sessionPath] of Object.entries(coworker.sessions)) {
			if (typeof sessionPath !== "string" || !existsSync(sessionPath)) continue;
			const source = resolve(sessionPath);
			if (!isUnder(source, sessionsRoot) || isOfficePath(source)) continue;
			const targetDir = join(dirname(source), OFFICE_SESSION_DIRNAME);
			const target = join(targetDir, basename(source));
			try {
				mkdirSync(targetDir, { recursive: true });
				if (existsSync(target)) {
					const sourceTime = statSync(source).mtimeMs;
					const targetTime = statSync(target).mtimeMs;
					if (sourceTime > targetTime) {
						rmSync(target, { force: true });
						renameSync(source, target);
					} else {
						unlinkSync(source);
					}
				} else {
					renameSync(source, target);
				}
				sessions[cwd] = target;
				changed = true;
				moved++;
			} catch {
				// A locked or missing file must not block startup. The old path
				// remains in the registry and can be retried on the next launch.
			}
		}
		if (changed) await store.saveCoworker({ ...coworker, sessions });
	}
	return moved;
}
