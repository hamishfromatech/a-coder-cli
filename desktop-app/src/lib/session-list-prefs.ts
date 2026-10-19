export type SessionListDensity = "compact" | "comfortable" | "detailed";
export type SessionMetaId = "messages" | "tokens" | "cost" | "model";

export interface SessionListPrefs {
	density: SessionListDensity;
	meta: SessionMetaId[];
}

export const SESSION_LIST_DENSITIES: { id: SessionListDensity; label: string; detail: string }[] = [
	{ id: "compact", label: "Compact", detail: "One line per session" },
	{ id: "comfortable", label: "Comfortable", detail: "Title plus last-message preview" },
	{ id: "detailed", label: "Detailed", detail: "Preview plus model and usage" },
];

export const SESSION_META_ITEMS: { id: SessionMetaId; label: string }[] = [
	{ id: "messages", label: "Message count" },
	{ id: "tokens", label: "Tokens" },
	{ id: "cost", label: "Cost" },
	{ id: "model", label: "Model" },
];

const STORAGE_KEY = "a-coder:session-list-prefs";
const DENSITIES = new Set<SessionListDensity>(SESSION_LIST_DENSITIES.map((item) => item.id));
const META = new Set<SessionMetaId>(SESSION_META_ITEMS.map((item) => item.id));

export const DEFAULT_SESSION_LIST_PREFS: SessionListPrefs = {
	density: "compact",
	meta: ["messages"],
};

export function readSessionListPrefs(storage?: Pick<Storage, "getItem">): SessionListPrefs {
	try {
		const raw = (storage ?? globalThis.localStorage).getItem(STORAGE_KEY);
		if (!raw) return { ...DEFAULT_SESSION_LIST_PREFS, meta: [...DEFAULT_SESSION_LIST_PREFS.meta] };
		const parsed = JSON.parse(raw) as Partial<SessionListPrefs> | null;
		const density = parsed?.density && DENSITIES.has(parsed.density) ? parsed.density : DEFAULT_SESSION_LIST_PREFS.density;
		const meta = Array.isArray(parsed?.meta)
			? parsed.meta.filter((id): id is SessionMetaId => typeof id === "string" && META.has(id as SessionMetaId))
			: [...DEFAULT_SESSION_LIST_PREFS.meta];
		return { density, meta };
	} catch {
		return { ...DEFAULT_SESSION_LIST_PREFS, meta: [...DEFAULT_SESSION_LIST_PREFS.meta] };
	}
}

export function writeSessionListPrefs(
	prefs: SessionListPrefs,
	storage?: Pick<Storage, "setItem">,
): void {
	try {
		(storage ?? globalThis.localStorage).setItem(STORAGE_KEY, JSON.stringify(prefs));
	} catch {
		/* storage unavailable — keep the in-memory choice */
	}
}
