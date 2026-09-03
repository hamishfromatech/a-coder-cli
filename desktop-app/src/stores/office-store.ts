/**
 * Your Office store — roster snapshot + open huddle logs, fed by the engine's
 * office_update / office_huddle / office_activity events.
 */

import { create } from "zustand";
import * as rpc from "../lib/rpc";
import type { OfficeActivityItem, OfficeHuddlePayload, OfficeSnapshot } from "../lib/rpc";

/** Ring-buffer cap for live activity feeding the floor view. */
const ACTIVITY_LIMIT = 300;

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

	refresh: () => Promise<void>;
	applySnapshot: (snapshot: OfficeSnapshot) => void;
	applyHuddle: (payload: OfficeHuddlePayload) => void;
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

	applyActivity: (item) =>
		set((state) => ({
			activity: [...state.activity.slice(-(ACTIVITY_LIMIT - 1)), item],
		})),

	openHuddle: async (huddleId) => {
		set({ openHuddleId: huddleId });
		if (!huddleId) return;
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