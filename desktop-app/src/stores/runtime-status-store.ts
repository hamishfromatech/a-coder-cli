import { create } from "zustand";
import type { RuntimeSessionStatus } from "../lib/rpc";

/**
 * Background runtime status — the desktop side of the engine's runtime
 * registry (Phase 1 of desktop-app/SESSION-ARCHITECTURE.md). Tracks, per
 * session file, whether a turn is running in the background and whether a
 * turn finished while the session was NOT the active tab (so the tab strip
 * can badge it until the user visits it again).
 */

interface RuntimeStatusState {
	/** sessionFile → turn/compaction in flight on that runtime. */
	running: Record<string, boolean>;
	/** sessionFile → when a turn finished while the session was in the
	 *  background. Cleared when the user activates that session. */
	finishedWhileAway: Record<string, number>;
	/** sessionFile → a permission prompt / extension dialog is pending on that
	 *  runtime (it cannot proceed until answered). */
	needsInput: Record<string, boolean>;
	update: (statuses: RuntimeSessionStatus[], activePath: string | null) => void;
	markVisited: (sessionFile: string) => void;
	clear: () => void;
}

export const useRuntimeStatusStore = create<RuntimeStatusState>((set, get) => ({
	running: {},
	finishedWhileAway: {},
	needsInput: {},
	update: (statuses, activePath) =>
		set((s) => {
			const nextRunning: Record<string, boolean> = {};
			const nextNeedsInput: Record<string, boolean> = {};
			const nextFinished = { ...s.finishedWhileAway };
			const prevRunning = s.running;

			for (const status of statuses) {
				if (!status.sessionFile) continue;
				nextRunning[status.sessionFile] = status.running;
				if (status.needsInput) nextNeedsInput[status.sessionFile] = true;

				// A background turn finished: mark it for the tab badge unless the
				// user is already looking at that session.
				const wasRunning = prevRunning[status.sessionFile];
				const isAway = activePath !== null && status.sessionFile !== activePath && !status.active;
				if (wasRunning && !status.running && isAway && !nextFinished[status.sessionFile]) {
					nextFinished[status.sessionFile] = Date.now();
				}
				// Actively-watched sessions clear their badge as soon as they
				// start running again (or the user is on the tab).
				if (!isAway) {
					delete nextFinished[status.sessionFile];
				}
			}

			// Drop entries for runtimes the engine no longer knows about.
			for (const file of Object.keys(nextRunning)) {
				if (!statuses.some((s2) => s2.sessionFile === file)) {
					delete nextRunning[file];
				}
			}

			return { running: nextRunning, finishedWhileAway: nextFinished, needsInput: nextNeedsInput };
		}),
	markVisited: (sessionFile) => {
		if (!get().finishedWhileAway[sessionFile]) return;
		set((s) => {
			const { [sessionFile]: _cleared, ...rest } = s.finishedWhileAway;
			return { finishedWhileAway: rest };
		});
	},
	clear: () => set({ running: {}, finishedWhileAway: {}, needsInput: {} }),
}));