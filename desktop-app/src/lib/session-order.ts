const STORAGE_KEY = "a-coder:session-order";

export function readSessionOrder(storage?: Pick<Storage, "getItem">): string[] {
	try {
		const raw = (storage ?? globalThis.localStorage).getItem(STORAGE_KEY);
		if (!raw) return [];
		const parsed = JSON.parse(raw) as unknown;
		return Array.isArray(parsed) ? parsed.filter((path): path is string => typeof path === "string") : [];
	} catch {
		return [];
	}
}

export function writeSessionOrder(paths: string[], storage?: Pick<Storage, "setItem">): void {
	try {
		(storage ?? globalThis.localStorage).setItem(STORAGE_KEY, JSON.stringify(paths));
	} catch {
		/* storage disabled — ordering lasts for this run */
	}
}

/** Apply the saved manual order; unseen sessions keep their incoming order. */
export function applySessionOrder<T extends { path: string }>(sessions: T[], order: readonly string[]): T[] {
	if (order.length === 0) return sessions;
	const rank = new Map(order.map((path, index) => [path, index]));
	return [...sessions].sort((a, b) => {
		const left = rank.get(a.path);
		const right = rank.get(b.path);
		if (left === undefined && right === undefined) return 0;
		if (left === undefined) return 1;
		if (right === undefined) return -1;
		return left - right;
	});
}
