/**
 * Pinned sessions: a desktop-local preference (the engine has no pin concept).
 * Pinned sessions sort above the date groups in the rail and survive restarts.
 */

const STORAGE_KEY = "a-coder.sessions.pinned";

export function readPinnedSessions(): string[] {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed: unknown = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((p): p is string => typeof p === "string") : [];
	} catch {
		return [];
	}
}

export function writePinnedSessions(paths: string[]): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(paths));
	} catch {
		/* storage disabled — pins are a convenience, not state we must keep */
	}
}

export function togglePin(path: string): string[] {
	const current = readPinnedSessions();
	const next = current.includes(path) ? current.filter((p) => p !== path) : [...current, path];
	writePinnedSessions(next);
	return next;
}
