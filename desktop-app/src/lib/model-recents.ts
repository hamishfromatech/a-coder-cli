const STORAGE_KEY = "a-coder:recent-models";
const MAX_RECENTS = 6;

export interface RecentModelKey {
	provider: string;
	id: string;
}

export function modelKey(provider: string, id: string): string {
	return `${provider}/${id}`;
}

export function readRecentModels(storage?: Pick<Storage, "getItem">): RecentModelKey[] {
	try {
		const raw = (storage ?? globalThis.localStorage).getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return [];
		const seen = new Set<string>();
		const result: RecentModelKey[] = [];
		for (const entry of parsed) {
			if (!entry || typeof entry !== "object") continue;
			const provider = (entry as { provider?: unknown }).provider;
			const id = (entry as { id?: unknown }).id;
			if (typeof provider !== "string" || typeof id !== "string") continue;
			const key = modelKey(provider, id);
			if (seen.has(key)) continue;
			seen.add(key);
			result.push({ provider, id });
			if (result.length >= MAX_RECENTS) break;
		}
		return result;
	} catch {
		return [];
	}
}

export function recordRecentModel(
	provider: string,
	id: string,
	storage?: Pick<Storage, "getItem" | "setItem">,
): RecentModelKey[] {
	const key = modelKey(provider, id);
	const next = [
		{ provider, id },
		...readRecentModels(storage).filter((entry) => modelKey(entry.provider, entry.id) !== key),
	].slice(0, MAX_RECENTS);
	try {
		(storage ?? globalThis.localStorage).setItem(STORAGE_KEY, JSON.stringify(next));
	} catch {
		/* storage disabled — recents are a convenience */
	}
	return next;
}
