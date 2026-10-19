/**
 * Your Office store — roster snapshot + open huddle logs, fed by the engine's
 * office_update / office_huddle / office_activity events.
 */

import { create } from "zustand";
import * as rpc from "../lib/rpc";
import { useOfficeReadStore } from "./office-read-store";
import type { OfficeActivityItem, OfficeHuddleDelta, OfficeHuddlePayload, OfficeSnapshot } from "../lib/rpc";

/** Ring-buffer cap for live activity feeding the floor view. */
const ACTIVITY_LIMIT = 300;
const PINNED_KEY = "a-coder.office.pinned";

function loadPinned(): string[] {
	if (typeof window === "undefined") return [];
	try {
		const parsed = JSON.parse(window.localStorage.getItem(PINNED_KEY) ?? "[]");
		return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
	} catch {
		return [];
	}
}

function savePinned(ids: string[]): void {
	if (typeof window === "undefined") return;
	try {
		window.localStorage.setItem(PINNED_KEY, JSON.stringify(ids));
	} catch {
		// Storage can be disabled; the in-memory pin still works.
	}
}

interface OfficeState {
	/** Latest roster snapshot (null until the engine pushes or a fetch lands). */
	snapshot: OfficeSnapshot | null;
	/** Open huddle payloads by id (kept warm as events arrive). */
	huddles: Record<string, OfficeHuddlePayload>;
	/** The huddle currently open in the panel. */
	openHuddleId: string | null;
	/** Last load error, for the panel's error row. */
	error: string | null;
	/** Live coworker activity ring buffer (oldest first), for the floor view. */
	activity: OfficeActivityItem[];
	/** Pinned huddles/DMs (client-local, sorted first in the roster). */
	pinned: string[];
	togglePinned: (id: string) => void;

	refresh: () => Promise<void>;
	applySnapshot: (snapshot: OfficeSnapshot) => void;
	applyHuddle: (payload: OfficeHuddlePayload) => void;
	applyHuddleDelta: (delta: OfficeHuddleDelta) => void;
	applyActivity: (item: OfficeActivityItem) => void;
	openHuddle: (huddleId: string | null) => Promise<void>;
	send: (text: string) => Promise<void>;
	stop: () => Promise<void>;
	respond: (requestId: string, choice: string | null) => Promise<void>;
}

export const useOfficeStore = create<OfficeState>((set, get) => ({
	snapshot: null,
	huddles: {},
	openHuddleId: null,
	error: null,
	activity: [],
	pinned: loadPinned(),
	togglePinned: (id) =>
		set((state) => {
			const pinned = state.pinned.includes(id)
				? state.pinned.filter((entry) => entry !== id)
				: [...state.pinned, id];
			savePinned(pinned);
			return { pinned };
		}),

	refresh: async () => {
		try {
			const snapshot = await rpc.officeList();
			set({ snapshot, error: null });
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) });
		}
	},

	applySnapshot: (snapshot) => set({ snapshot, error: null }),

	applyHuddle: (payload) =>
		set((state) => ({ huddles: { ...state.huddles, [payload.huddleId]: payload } })),

	applyHuddleDelta: (delta) =>
		set((state) => {
			const previous = state.huddles[delta.huddleId];
			// A delta is only meaningful once the room has been loaded (full
			// payload or fetch); otherwise the next open fetches it.
			if (!previous) return state;
			const seen = new Set(previous.data.log.map((message) => message.id));
			const messages = delta.messages.filter((message) => !seen.has(message.id));
			return {
				huddles: {
					...state.huddles,
					[delta.huddleId]: {
						huddleId: delta.huddleId,
						working: delta.working,
						data: {
							...previous.data,
							epoch: delta.epoch,
							running: delta.running,
							log: [...previous.data.log, ...messages],
						},
					},
				},
			};
		}),

	applyActivity: (item) =>
		set((state) => ({
			activity: [...state.activity.slice(-(ACTIVITY_LIMIT - 1)), item],
		})),

	openHuddle: async (huddleId) => {
		set({ openHuddleId: huddleId });
		if (!huddleId) return;
		useOfficeReadStore.getState().markRead(huddleId);
		// Fetch if not warm; events keep it fresh afterwards.
		if (get().huddles[huddleId]) return;
		try {
			const payload = await rpc.officeGetHuddle(huddleId);
			if (payload) {
				get().applyHuddle(payload);
			}
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) });
		}
	},

	send: async (text) => {
		const huddleId = get().openHuddleId;
		if (!huddleId || !text.trim()) return;
		await rpc.officeSend(huddleId, text.trim());
	},

	stop: async () => {
		const huddleId = get().openHuddleId;
		if (!huddleId) return;
		await rpc.officeStop(huddleId);
	},

	respond: async (requestId, choice) => {
		await rpc.officeRespond(requestId, choice);
	},
}));