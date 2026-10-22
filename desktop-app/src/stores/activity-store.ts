import { create } from "zustand";

/**
 * Decision inbox — the unified queue of "what needs me" and "what did agents
 * do". Items are keyed by their source, so a run's started row is replaced by
 * its finished row instead of duplicated. Dismissed, snoozed, and resolved
 * state is persisted locally; transcript/run contents are not.
 */

export type ActivitySeverity = "info" | "success" | "error" | "action";
export type ActivityKind = "cron" | "approval" | "session" | "system";
export type ActivityOrigin = "human" | "automation";
export type ActivityStatus = "open" | "snoozed" | "dismissed" | "resolved";
export type ActivityActionKind = "open" | "review" | "approve" | "retry" | "pause";

export interface ActivityAction {
	kind: ActivityActionKind;
	label: string;
}

export interface ActivityItem {
	id: string;
	/** Stable source key, e.g. `cron:run:<id>` or `approval:request:<id>`. */
	key: string;
	kind: ActivityKind;
	origin: ActivityOrigin;
	status: ActivityStatus;
	/** "action" items need the user; "error" items failed. */
	severity: ActivitySeverity;
	title: string;
	detail?: string;
	at: number;
	/** Session to open when clicked — a run's session or the pending-approval session. */
	sessionFile?: string;
	jobId?: string;
	runId?: string;
	requestId?: string;
	/** Live marker — a run that started but has not finished yet. */
	running?: boolean;
	action?: ActivityAction;
	snoozedUntil?: number;
	resolvedAt?: number;
}

const MAX_ITEMS = 200;
const MAX_SUPPRESSED = 200;
const STORAGE_KEY = "a-coder-decisions-v1";

interface PersistedSuppression {
	status: "snoozed" | "dismissed" | "resolved";
	snoozedUntil?: number;
	at: number;
}

interface PersistedDecisionState {
	seenAt: number;
	suppressed: Record<string, PersistedSuppression>;
}

function readPersisted(): PersistedDecisionState {
	if (typeof localStorage === "undefined") return { seenAt: 0, suppressed: {} };
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return { seenAt: 0, suppressed: {} };
		const parsed = JSON.parse(raw) as Partial<PersistedDecisionState>;
		return {
			seenAt: typeof parsed.seenAt === "number" ? parsed.seenAt : 0,
			suppressed:
				parsed.suppressed && typeof parsed.suppressed === "object" && !Array.isArray(parsed.suppressed)
					? parsed.suppressed as Record<string, PersistedSuppression>
					: {},
		};
	} catch {
		return { seenAt: 0, suppressed: {} };
	}
}

function writePersisted(seenAt: number, items: ActivityItem[]): void {
	if (typeof localStorage === "undefined") return;
	const suppressed: Record<string, PersistedSuppression> = {};
	for (const item of items) {
		if (item.status === "open") continue;
		suppressed[item.key] = {
			status: item.status,
			...(item.snoozedUntil !== undefined ? { snoozedUntil: item.snoozedUntil } : {}),
			at: item.resolvedAt ?? item.at,
		};
	}
	const entries = Object.entries(suppressed)
		.sort((a, b) => (b[1].at ?? 0) - (a[1].at ?? 0))
		.slice(0, MAX_SUPPRESSED);
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify({ seenAt, suppressed: Object.fromEntries(entries) }));
	} catch {
		// Storage may be unavailable in tests or a restricted webview.
	}
}

type ActivityAddInput = Omit<ActivityItem, "id" | "key" | "status" | "origin"> & {
	key?: string;
	status?: ActivityStatus;
	origin?: ActivityOrigin;
};

function sourceKey(item: ActivityAddInput): string {
	if (item.key) return item.key;
	if (item.runId) return `${item.kind}:run:${item.runId}`;
	if (item.requestId) return `${item.kind}:request:${item.requestId}`;
	return `${item.kind}:${item.title}:${item.sessionFile ?? ""}`;
}

function effectiveStatus(item: ActivityItem, now = Date.now()): ActivityStatus {
	if (item.status === "snoozed" && item.snoozedUntil !== undefined && item.snoozedUntil <= now) return "open";
	return item.status;
}

function applySuppression(item: ActivityItem, suppression: PersistedSuppression | undefined, now = Date.now()): ActivityItem {
	if (!suppression) return item;
	if (suppression.status === "snoozed") {
		if (suppression.snoozedUntil !== undefined && suppression.snoozedUntil <= now) {
			return { ...item, status: "open", snoozedUntil: undefined };
		}
		return { ...item, status: "snoozed", snoozedUntil: suppression.snoozedUntil };
	}
	return { ...item, status: suppression.status, resolvedAt: suppression.at };
}

interface ActivityState {
	items: ActivityItem[];
	/** Epoch ms of the last "marked seen" — items newer than this are unread. */
	seenAt: number;
	/** Add an item (newest first). A stable source key replaces lifecycle updates. */
	add: (item: ActivityAddInput) => void;
	markSeen: () => void;
	dismiss: (key: string) => void;
	snooze: (key: string, until: number) => void;
	resolve: (key: string) => void;
	restore: (key: string) => void;
	clearHistory: () => void;
	clear: () => void;
}

let counter = 0;
function mintItemId(): string {
	counter += 1;
	return `act_${Date.now().toString(36)}_${counter.toString(36)}`;
}

const persisted = readPersisted();

export const useActivityStore = create<ActivityState>((set) => ({
	items: [],
	seenAt: persisted.seenAt,

	add: (item) =>
		set((s) => {
			const now = Date.now();
			const key = sourceKey(item);
			const existing = s.items.find((entry) => entry.key === key);
			const suppression = persisted.suppressed[key];
			const next = applySuppression(
				{
					...item,
					id: existing?.id ?? mintItemId(),
					key,
					status: item.status ?? "open",
					origin: item.origin ?? "automation",
				} as ActivityItem,
				suppression,
				now,
			);
			if (existing) {
				next.id = existing.id;
				// A dismissed/resolved item stays suppressed. A snoozed item that
				// expired becomes open and clears its persisted suppression.
				if (existing.status === "dismissed" || existing.status === "resolved") {
					next.status = existing.status;
					next.resolvedAt = existing.resolvedAt;
				} else if (existing.status === "snoozed" && existing.snoozedUntil !== undefined && existing.snoozedUntil > now) {
					next.status = "snoozed";
					next.snoozedUntil = existing.snoozedUntil;
				} else if (suppression?.status === "snoozed" && (suppression.snoozedUntil ?? 0) <= now) {
					delete persisted.suppressed[key];
					writePersisted(s.seenAt, s.items);
				}
			}
			const items = [next, ...s.items.filter((entry) => entry.key !== key)].slice(0, MAX_ITEMS);
			return { items };
		}),

	markSeen: () =>
		set((s) => {
			const seenAt = Date.now();
			writePersisted(seenAt, s.items);
			return { seenAt };
		}),

	dismiss: (key) =>
		set((s) => {
			const items = s.items.map((item) =>
				item.key === key ? { ...item, status: "dismissed" as const, resolvedAt: Date.now() } : item,
			);
			writePersisted(s.seenAt, items);
			return { items };
		}),

	snooze: (key, until) =>
		set((s) => {
			const items = s.items.map((item) =>
				item.key === key ? { ...item, status: "snoozed" as const, snoozedUntil: until } : item,
			);
			writePersisted(s.seenAt, items);
			return { items };
		}),

	resolve: (key) =>
		set((s) => {
			const items = s.items.map((item) =>
				item.key === key ? { ...item, status: "resolved" as const, resolvedAt: Date.now() } : item,
			);
			writePersisted(s.seenAt, items);
			return { items };
		}),

	restore: (key) =>
		set((s) => {
			const items = s.items.map((item) =>
				item.key === key ? { ...item, status: "open" as const, snoozedUntil: undefined, resolvedAt: undefined } : item,
			);
			delete persisted.suppressed[key];
			writePersisted(s.seenAt, items);
			return { items };
		}),

	clearHistory: () =>
		set((s) => {
			const items = s.items.filter((item) => effectiveStatus(item) === "open");
			writePersisted(s.seenAt, items);
			return { items };
		}),

	clear: () =>
		set(() => {
			persisted.suppressed = {};
			const seenAt = Date.now();
			writePersisted(seenAt, []);
			return { items: [], seenAt };
		}),
}));

export function activityStatus(item: ActivityItem, now = Date.now()): ActivityStatus {
	return effectiveStatus(item, now);
}

export function isAttentionItem(item: ActivityItem, now = Date.now()): boolean {
	return effectiveStatus(item, now) === "open" && (item.severity === "error" || item.severity === "action");
}

export function selectOpenItems(items: ActivityItem[], now = Date.now()): ActivityItem[] {
	return items.filter((item) => effectiveStatus(item, now) === "open");
}

export function selectSnoozedItems(items: ActivityItem[], now = Date.now()): ActivityItem[] {
	return items.filter((item) => effectiveStatus(item, now) === "snoozed");
}

export function selectHistoryItems(items: ActivityItem[], now = Date.now()): ActivityItem[] {
	return items.filter((item) => {
		const status = effectiveStatus(item, now);
		return status === "dismissed" || status === "resolved";
	});
}

/** Unread items that should pull the user's attention (the badge count). */
export function attentionCount(state: Pick<ActivityState, "items" | "seenAt">, now = Date.now()): number {
	return state.items.filter((item) => item.at > state.seenAt && isAttentionItem(item, now)).length;
}

export function useActivityAttentionCount(): number {
	return useActivityStore((s) => attentionCount(s));
}
