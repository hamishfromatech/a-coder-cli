/**
 * Per-huddle read pointers for the roster's unread dots.
 *
 * The engine's huddle summary carries `lastActive`; a local read timestamp per
 * huddle is enough to decide whether there is anything new. Persisted per
 * client (localStorage) and initialized to "now" on first run so an existing
 * office does not open with every room marked unread.
 */

import { create } from "zustand";

const STORAGE_KEY = "a-coder.office.readAt";

interface StoredReadState {
	readAt: Record<string, number>;
	initializedAt: number;
	unread: Record<string, number>;
	mentions: Record<string, boolean>;
}

function loadState(): StoredReadState {
	const fallback: StoredReadState = { readAt: {}, initializedAt: Date.now(), unread: {}, mentions: {} };
	if (typeof window === "undefined") return fallback;
	try {
		const raw = window.localStorage.getItem(STORAGE_KEY);
		if (!raw) {
			window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback));
			return fallback;
		}
		const parsed = JSON.parse(raw) as Partial<StoredReadState>;
		return {
			readAt: parsed.readAt && typeof parsed.readAt === "object" ? parsed.readAt : {},
			initializedAt: typeof parsed.initializedAt === "number" ? parsed.initializedAt : Date.now(),
			unread: parsed.unread && typeof parsed.unread === "object" ? parsed.unread : {},
			mentions: parsed.mentions && typeof parsed.mentions === "object" ? parsed.mentions : {},
		};
	} catch {
		return fallback;
	}
}

interface OfficeReadState extends StoredReadState {
	recordActivity: (huddleId: string, count: number, mentioned: boolean) => void;
	markRead: (huddleId: string, at?: number) => void;
}

export const useOfficeReadStore = create<OfficeReadState>()((set, get) => ({
	...loadState(),

	recordActivity: (huddleId, count, mentioned) => {
		if (count <= 0 && !mentioned) return;
		set((state) => {
			const unread = { ...state.unread, [huddleId]: (state.unread[huddleId] ?? 0) + Math.max(0, count) };
			const mentions = mentioned ? { ...state.mentions, [huddleId]: true } : state.mentions;
			try {
				window.localStorage.setItem(
					STORAGE_KEY,
					JSON.stringify({ readAt: state.readAt, initializedAt: state.initializedAt, unread, mentions }),
				);
			} catch {
				// Storage disabled: keep the in-memory counters.
			}
			return { unread, mentions };
		});
	},

	markRead: (huddleId, at = Date.now()) => {
		const state = get();
		const current = state.readAt[huddleId] ?? 0;
		if (current >= at && !state.unread[huddleId] && !state.mentions[huddleId]) return;
		set((currentState) => {
			const readAt = { ...currentState.readAt, [huddleId]: Math.max(currentState.readAt[huddleId] ?? 0, at) };
			const unread = { ...currentState.unread };
			delete unread[huddleId];
			const mentions = { ...currentState.mentions };
			delete mentions[huddleId];
			try {
				window.localStorage.setItem(
					STORAGE_KEY,
					JSON.stringify({ readAt, initializedAt: currentState.initializedAt, unread, mentions }),
				);
			} catch {
				// Storage disabled: keep the in-memory pointer.
			}
			return { readAt, unread, mentions };
		});
	},
}));

/** True when a huddle's last activity is newer than its local read pointer. */
export function isHuddleUnread(
	lastActive: number | undefined,
	readAt: Record<string, number>,
	initializedAt: number,
	huddleId: string,
): boolean {
	if (!lastActive) return false;
	return lastActive > (readAt[huddleId] ?? initializedAt);
}
