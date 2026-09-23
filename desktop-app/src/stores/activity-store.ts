import { create } from "zustand";

/**
 * Activity inbox — one aggregated feed of "what did agents do / what needs
 * me": cron run lifecycle, pending approvals. Items newer than `seenAt` are
 * unread; errors and attention-needing items drive the sidebar badge.
 */

export type ActivitySeverity = "info" | "success" | "error" | "action";
export type ActivityKind = "cron" | "approval";

export interface ActivityItem {
	id: string;
	kind: ActivityKind;
	/** "action" items need the user (approvals); "error" items failed. */
	severity: ActivitySeverity;
	title: string;
	detail?: string;
	at: number;
	/** Session to open when clicked — a run's session or the pending-approval session. */
	sessionFile?: string;
	jobId?: string;
	runId?: string;
	/** Live marker — a run that started but has not finished yet. */
	running?: boolean;
}

const MAX_ITEMS = 100;

function dedupeKey(item: Pick<ActivityItem, "kind" | "title" | "sessionFile">): string {
	return `${item.kind}:${item.title}:${item.sessionFile ?? ""}`;
}

interface ActivityState {
	items: ActivityItem[];
	/** Epoch ms of the last "marked seen" — items newer than this are unread. */
	seenAt: number;
	/** Add an item (newest first). An item with the same kind/title/session
	 *  replaces its predecessor instead of stacking duplicates. */
	add: (item: Omit<ActivityItem, "id">) => void;
	markSeen: () => void;
	dismiss: (id: string) => void;
	clear: () => void;
}

let counter = 0;
function mintItemId(): string {
	counter += 1;
	return `act_${Date.now().toString(36)}_${counter.toString(36)}`;
}

export const useActivityStore = create<ActivityState>((set) => ({
	items: [],
	seenAt: 0,
	add: (item) =>
		set((s) => {
			const keyed: ActivityItem = { ...item, id: mintItemId() };
			const key = dedupeKey(keyed);
			// A finished run replaces its "started" placeholder so the row
			// transitions in place instead of stacking two entries.
			const items = [
				keyed,
				...s.items.filter(
					(existing) =>
						dedupeKey(existing) !== key &&
						!(keyed.runId && existing.runId === keyed.runId && existing.running),
				),
			].slice(0, MAX_ITEMS);
			return { items };
		}),
	markSeen: () => set({ seenAt: Date.now() }),
	dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
	clear: () => set({ items: [] }),
}));

/** Unread items that should pull the user's attention (the badge count). */
export function attentionCount(state: Pick<ActivityState, "items" | "seenAt">): number {
	return state.items.filter((i) => i.at > state.seenAt && (i.severity === "error" || i.severity === "action"))
		.length;
}

export function useActivityAttentionCount(): number {
	return useActivityStore((s) => attentionCount(s));
}