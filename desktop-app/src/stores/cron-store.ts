/**
 * Cron store — scheduled tasks for the main agent, fed by the engine's
 * cron_update events (pushed on every mutation and fire) and cron_list.
 */

import { create } from "zustand";
import * as rpc from "../lib/rpc";
import type { CronJob, CronRun } from "../lib/rpc";

interface CronState {
	jobs: CronJob[];
	/** Last load error, for the panel's error row. */
	error: string | null;
	/** Epoch ms of the last successful load. */
	loadedAt: number | null;
	/** All runs (every job), fetched for the calendar view; may trail live fires. */
	runs: CronRun[];
	runsLoadedAt: number | null;

	refresh: () => Promise<void>;
	applyJobs: (jobs: CronJob[]) => void;
	/** Apply a live `cron_run` event (started → insert, finished → replace). */
	applyRun: (run: CronRun) => void;
	refreshRuns: () => Promise<void>;
}

export const useCronStore = create<CronState>((set) => ({
	jobs: [],
	error: null,
	loadedAt: null,
	runs: [],
	runsLoadedAt: null,

	refresh: async () => {
		try {
			const snapshot = await rpc.cronList();
			set({ jobs: snapshot.jobs, error: null, loadedAt: Date.now() });
		} catch (e) {
			set({ error: e instanceof Error ? e.message : String(e) });
		}
	},

	applyJobs: (jobs) => set({ jobs, error: null, loadedAt: Date.now() }),

	applyRun: (run) =>
		set((state) => {
			const next = state.runs.filter((entry) => entry.id !== run.id);
			next.push(run);
			next.sort((a, b) => b.startedAt - a.startedAt);
			return { runs: next.slice(0, 200) };
		}),

	refreshRuns: async () => {
		try {
			const result = await rpc.cronRuns();
			set({ runs: result.runs, runsLoadedAt: Date.now() });
		} catch {
			// Calendar still renders upcoming fires without history.
		}
	},
}));