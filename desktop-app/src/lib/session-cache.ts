import type { AgentMessage } from "@earendil-works/pi-agent-core";

/**
 * Warm per-session transcript cache — the desktop equivalent of hermes-agent's
 * SessionStateCache. Switching sessions re-fetches history from the engine via
 * `session_start`; painting the cached transcript first makes switching back to
 * a recently-visited session feel instant instead of blank-then-fill.
 *
 * Capped LRU by entry count: entries are plain message arrays (shared with the
 * session store until replaced), so the memory ceiling only needs to bound the
 * number of warm sessions, not deep-copy transcripts.
 */

const MAX_SESSIONS = 24;

const cache = new Map<string, AgentMessage[]>();

export function getCachedSessionMessages(sessionFile: string): AgentMessage[] | undefined {
	const hit = cache.get(sessionFile);
	if (hit) {
		// Refresh recency.
		cache.delete(sessionFile);
		cache.set(sessionFile, hit);
	}
	return hit;
}

export function setCachedSessionMessages(sessionFile: string, messages: AgentMessage[]): void {
	if (!sessionFile) return;
	cache.delete(sessionFile);
	cache.set(sessionFile, messages);
	while (cache.size > MAX_SESSIONS) {
		const oldest = cache.keys().next().value;
		if (oldest === undefined) break;
		cache.delete(oldest);
	}
}

export function clearSessionCache(): void {
	cache.clear();
}