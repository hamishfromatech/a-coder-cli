export type StatusBarItemId =
	| "thinking"
	| "permission"
	| "plan"
	| "processes"
	| "agents"
	| "context"
	| "stats";

export const STATUS_BAR_ITEMS: { id: StatusBarItemId; label: string }[] = [
	{ id: "thinking", label: "Thinking level" },
	{ id: "permission", label: "Permission mode" },
	{ id: "plan", label: "Plan mode indicator" },
	{ id: "processes", label: "Background processes" },
	{ id: "agents", label: "Background agents" },
	{ id: "context", label: "Context usage" },
	{ id: "stats", label: "Messages, tools, tokens, cost" },
];

const STORAGE_KEY = "a-coder:statusbar-hidden";

const VALID = new Set<StatusBarItemId>(STATUS_BAR_ITEMS.map((item) => item.id));

export function readHiddenStatusItems(storage?: Pick<Storage, "getItem">): Set<StatusBarItemId> {
	try {
		const raw = (storage ?? globalThis.localStorage).getItem(STORAGE_KEY);
		if (!raw) return new Set();
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed)) return new Set();
		return new Set(parsed.filter((id): id is StatusBarItemId => typeof id === "string" && VALID.has(id as StatusBarItemId)));
	} catch {
		return new Set();
	}
}

export function writeHiddenStatusItems(
	hidden: ReadonlySet<StatusBarItemId>,
	storage?: Pick<Storage, "setItem">,
): void {
	try {
		(storage ?? globalThis.localStorage).setItem(STORAGE_KEY, JSON.stringify([...hidden]));
	} catch {
		/* storage unavailable — the bar just keeps its defaults */
	}
}
