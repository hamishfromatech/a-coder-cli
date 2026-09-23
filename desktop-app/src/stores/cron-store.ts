/**
 * Cron store — scheduled tasks for the main agent, fed by the engine's
 * cron_update events (pushed on every mutation and fire) and cron_list.
 */

import { create } from "zustand";
import * as rpc from "../lib/rpc";
import type { CronJob } from "../lib/rpc";

interface CronState {
	jobs: CronJob[];
	/** Last load error, for the panel's error row. */
	error: string | null;
	/** Epoch ms of the last successful load. */
	loadedAt: number | null;

	refresh: () => Promise<void>;
	applyJobs: (jobs: CronJob[]) => void;
}

export const useCronStore = create<CronState>((set) => ({
	jobs: [],
	error: null,
	loadedAt: null,

	refresh: async () => {
		try {
			const snapshot = await rpc.cronList();
			set({ jobs: snapshot.jobs, error: null, loadedAt: Date.now() });
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) });
		}
	},

	applyJobs: (jobs) => set({ jobs, error: null, loadedAt: Date.now() }),
}));