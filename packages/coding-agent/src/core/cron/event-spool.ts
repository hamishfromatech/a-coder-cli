/**
 * Cross-process host-event spool.
 *
 * Followers do not tick, but a `turn_end` event can happen in any engine
 * process. Followers append it here; the scheduler leader drains the spool at
 * the start of its next tick. `appendFileSync` is O_APPEND on the platforms we
 * support, so concurrent one-line appends do not interleave.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "../../config.ts";
import type { CronHostEvent } from "./service.ts";

function spoolPath(): string {
	return join(getAgentDir(), "cron", "events.jsonl");
}

export function appendCronEvent(event: CronHostEvent): void {
	const path = spoolPath();
	mkdirSync(dirname(path), { recursive: true });
	appendFileSync(path, `${JSON.stringify(event)}\n`, "utf-8");
}

/** Atomically take the current spool and return its events. */
export function drainCronEvents(): CronHostEvent[] {
	const path = spoolPath();
	if (!existsSync(path)) return [];
	const processing = `${path}.processing-${process.pid}-${Date.now()}`;
	try {
		renameSync(path, processing);
	} catch {
		return [];
	}
	try {
		const lines = readFileSync(processing, "utf-8").split(/\r?\n/);
		const events: CronHostEvent[] = [];
		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const parsed = JSON.parse(line) as Partial<CronHostEvent>;
				if ((parsed.type === "turn_end" || parsed.type === "git_commit") && typeof parsed.cwd === "string") {
					events.push(parsed as CronHostEvent);
				}
			} catch {
				// Ignore a torn/foreign line and keep draining.
			}
		}
		return events;
	} finally {
		try {
			unlinkSync(processing);
		} catch {
			// Best effort.
		}
	}
}
