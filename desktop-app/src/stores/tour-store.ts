/**
 * Guided-tour state: an interactive first-run tour that walks new users
 * through the app's real surfaces (it drives the UI, then spotlights what it
 * drove). `completed` persists; the step position does not — restarting the
 * app mid-tour simply clears it.
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface TourState {
	/** Finished or skipped at least once; gates the first-run auto-start. */
	completed: boolean;
	/** Active step index; null = tour not running. */
	stepIndex: number | null;

	/** Start the tour from the beginning (or resume from step 0). */
	start: () => void;
	/** Auto-start for a brand-new user: only if never seen. */
	startForNewUser: () => void;
	next: () => void;
	back: () => void;
	/** Close the tour. `completed` is set either way so we never auto-nag. */
	end: () => void;
}

export const useTourStore = create<TourState>()(
	persist(
		(set, get) => ({
			completed: false,
			stepIndex: null,

			start: () => set({ stepIndex: 0 }),
			startForNewUser: () => {
				if (!get().completed) set({ stepIndex: 0 });
			},
			next: () => {
				const { stepIndex } = get();
				if (stepIndex === null) return;
				set({ stepIndex: stepIndex + 1 });
			},
			back: () => {
				const { stepIndex } = get();
				if (stepIndex === null || stepIndex <= 0) return;
				set({ stepIndex: stepIndex - 1 });
			},
			end: () => set({ stepIndex: null, completed: true }),
		}),
		{
			name: "a-coder-desktop-tour",
			partialize: (state) => ({ completed: state.completed }),
		},
	),
);