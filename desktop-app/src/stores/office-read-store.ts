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
}

function loadState(): StoredReadState {
	const fallback: StoredReadState = { readAt: {}, initializedAt: Date.now() };
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
		};
	} catch {
		return fallback;
	}
}

interface OfficeReadState extends StoredReadState {
	markRead: (huddleId: string, at?: number) => void;
}

export const useOfficeReadStore = create<OfficeReadState>()((set, get) => ({
	...loadState(),

	markRead: (huddleId, at = Date.now()) => {
		const current = get().readAt[huddleId] ?? 0;
		if (current >= at) return;
		set((state) => {
			const readAt = { ...state.readAt, [huddleId]: at };
			try {
				window.localStorage.setItem(
					STORAGE_KEY,
					JSON.stringify({ readAt, initializedAt: state.initializedAt }),
				);
			} catch {
				// Storage disabled: keep the in-memory pointer.
			}
			return { readAt };
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
