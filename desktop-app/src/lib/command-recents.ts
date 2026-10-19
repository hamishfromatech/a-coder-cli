const STORAGE_KEY = "a-coder:recent-commands";
const MAX_RECENTS = 5;

export function readRecentCommands(storage?: Pick<Storage, "getItem">): string[] {
	try {
		const raw = (storage ?? globalThis.localStorage).getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.filter((id): id is string => typeof id === "string").slice(0, MAX_RECENTS);
	} catch {
		return [];
	}
}

export function recordRecentCommand(id: string, storage?: Pick<Storage, "getItem" | "setItem">): string[] {
	const next = [id, ...readRecentCommands(storage).filter((entry) => entry !== id)].slice(0, MAX_RECENTS);
	try {
		(storage ?? globalThis.localStorage).setItem(STORAGE_KEY, JSON.stringify(next));
	} catch {
		/* storage disabled — recents are a convenience */
	}
	return next;
}
