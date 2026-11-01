// Pure list reordering for tab strips (browser pages and open sessions): move
// one item to another's slot, preserving the rest. Kept out of the stores so
// it stays testable without touching Tauri bindings.

export function moveBefore<T>(
	items: T[],
	idOf: (item: T) => string,
	sourceId: string,
	beforeId: string,
): T[] {
	const from = items.findIndex((item) => idOf(item) === sourceId);
	const to = items.findIndex((item) => idOf(item) === beforeId);
	if (from < 0 || to < 0 || from === to) return items;
	const next = [...items];
	const [moved] = next.splice(from, 1);
	// The target index is measured before the removal; pulling an item from
	// further left shifts it one slot left.
	next.splice(from < to ? to - 1 : to, 0, moved);
	return next;
}

/** Browser tabs key their identity on `id`. */
export function moveTabBefore<T extends { id: string }>(tabs: T[], tabId: string, beforeId: string): T[] {
	return moveBefore(tabs, (tab) => tab.id, tabId, beforeId);
}
