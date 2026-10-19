/**
 * Per-coworker session stats for the office detail view. Reads the same
 * session entries the transcript uses; tokens come from assistant usage and
 * "turns" counts user messages.
 */

import type { SessionEntry } from "../session-manager.ts";
import type { CoworkerSessionSummary } from "./types.ts";

function usageTokens(usage: unknown): number {
	if (typeof usage !== "object" || usage === null) return 0;
	const value = usage as {
		input?: unknown;
		output?: unknown;
		cacheRead?: unknown;
		cacheWrite?: unknown;
	};
	const number = (entry: unknown): number => (typeof entry === "number" && Number.isFinite(entry) ? entry : 0);
	return number(value.input) + number(value.output) + number(value.cacheRead) + number(value.cacheWrite);
}

export function summarizeCoworkerSession(
	entries: readonly SessionEntry[],
	path: string,
	cwd: string,
): CoworkerSessionSummary {
	let turns = 0;
	let tokens = 0;
	let messageCount = 0;
	let lastActivity = 0;
	let name: string | undefined;
	for (const entry of entries) {
		const entryTimestamp = Date.parse(entry.timestamp);
		if (Number.isFinite(entryTimestamp)) lastActivity = Math.max(lastActivity, entryTimestamp);
		if (entry.type === "session_info") {
			name = entry.name?.trim() || name;
		}
		if (entry.type !== "message") continue;
		messageCount += 1;
		if (entry.message.role === "user") turns += 1;
		if (entry.message.role === "assistant") tokens += usageTokens(entry.message.usage);
	}
	return { path, cwd, name, messageCount, turns, tokens, lastActivity };
}
