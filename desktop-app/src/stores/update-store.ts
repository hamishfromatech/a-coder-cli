/**
 * Update state for the desktop app.
 *
 * Holds the currently-available update (if any), the download/install progress,
 * and the user's dismissal state so we don't re-prompt them within the same
 * session after they dismiss an update notification.
 */

import { create } from "zustand";
import type { UpdateInfo, DownloadProgress } from "../lib/updater";

export type UpdateStatus =
	| "idle"
	| "checking"
	| "available"
	| "downloading"
	| "installing"
	| "ready-to-relaunch"
	| "up-to-date"
	| "error";

export interface UpdateState {
	status: UpdateStatus;
	/** Populated when an update is available or being installed. */
	update: UpdateInfo | null;
	/** Last error message, when status === "error". */
	error: string | null;
	/** Download progress: bytes downloaded / total bytes (if known). */
	downloadedBytes: number;
	totalBytes: number | null;
	/**
	 * Set when the user dismisses the update prompt for a specific version.
	 * We won't re-surface the modal for the same version in this session.
	 */
	dismissedVersion: string | null;

	setStatus: (status: UpdateStatus) => void;
	setUpdate: (update: UpdateInfo | null) => void;
	setError: (error: string | null) => void;
	setProgress: (event: DownloadProgress) => void;
	dismiss: (version: string) => void;
	reset: () => void;
}

export const useUpdateStore = create<UpdateState>((set) => ({
	status: "idle",
	update: null,
	error: null,
	downloadedBytes: 0,
	totalBytes: null,
	dismissedVersion: null,

	setStatus: (status) => set({ status }),
	setUpdate: (update) => set({ update }),
	setError: (error) => set({ error, status: error ? "error" : "idle" }),
	setProgress: (event) => {
		switch (event.kind) {
			case "started":
				set({
					status: "downloading",
					downloadedBytes: 0,
					totalBytes: event.contentLength ?? null,
				});
				break;
			case "progress":
				set((state) => ({
					status: "downloading",
					downloadedBytes: state.totalBytes
						? Math.min(state.totalBytes, event.totalDownloaded)
						: event.totalDownloaded,
				}));
				break;
			case "finished":
				set({ status: "ready-to-relaunch", downloadedBytes: 0, totalBytes: null });
				break;
		}
	},
	dismiss: (version) => set({ dismissedVersion: version, status: "idle" }),
	reset: () =>
		set({
			status: "idle",
			update: null,
			error: null,
			downloadedBytes: 0,
			totalBytes: null,
		}),
}));
