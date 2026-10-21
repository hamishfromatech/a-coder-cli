/**
 * Screen share for voice calls.
 *
 * The native side captures the selected display/window at ~2 Hz, compares a
 * small luma signature, and publishes a JPEG only when the screen materially
 * changed. The voice turn pulls the freshest frame and sends it through the
 * normal image-attachment path. Nothing streams continuously to the model.
 */

import { invoke } from "@tauri-apps/api/core";
import type { ImageContent } from "@earendil-works/pi-ai";
import { create } from "zustand";

export interface ScreenSource {
	id: string;
	kind: "display" | "window";
	name: string;
	appName: string;
	width: number;
	height: number;
	primary: boolean;
	focused: boolean;
}

export interface ScreenSources {
	permission: boolean;
	sources: ScreenSource[];
}

export interface ScreenFrame {
	base64: string;
	mimeType: string;
	width: number;
	height: number;
	version: number;
	changedRatio: number;
	capturedAt: number;
	sourceName: string;
}

export interface ScreenCaptureResult {
	changed: boolean;
	version: number;
	changedRatio: number;
	frame: ScreenFrame | null;
}

export interface ScreenStatus {
	active: boolean;
	sourceId: string | null;
	sourceName: string | null;
	permission: boolean;
	version: number;
}

interface ScreenShareState {
	active: boolean;
	permission: boolean;
	sources: ScreenSource[];
	sourceId: string | null;
	sourceName: string;
	preview: string | null;
	version: number;
	error: string;
	busy: boolean;
}

interface ScreenShareActions {
	listSources: () => Promise<ScreenSources>;
	requestPermission: () => Promise<boolean>;
	refreshStatus: () => Promise<void>;
	start: (sourceId: string) => Promise<boolean>;
	stop: () => Promise<void>;
	/** Latest frame for a voice turn, or null when sharing is off. */
	captureForTurn: () => Promise<ImageContent | null>;
}

export type ScreenShareStore = ScreenShareState & ScreenShareActions;

const POLL_MS = 600;
const SAME_FRAME_REFRESH_MS = 30_000;

let pollTimer: number | null = null;
let pollInFlight = false;
let lastAttachedVersion = -1;
let lastAttachedAt = 0;

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

export function screenFrameDataUrl(frame: ScreenFrame): string {
	return `data:${frame.mimeType};base64,${frame.base64}`;
}

/** Attach the first frame, then only changed frames, with a slow refresh. */
export function shouldAttachScreenFrame(
	version: number,
	lastVersion: number,
	lastAt: number,
	now = Date.now(),
): boolean {
	return version !== lastVersion || now - lastAt >= SAME_FRAME_REFRESH_MS;
}

function stopPolling(): void {
	if (pollTimer !== null) {
		window.clearInterval(pollTimer);
		pollTimer = null;
	}
}

export const useScreenShareStore = create<ScreenShareStore>()((set, get) => {
	async function poll(): Promise<void> {
		if (!get().active || pollInFlight) return;
		pollInFlight = true;
		const sourceId = get().sourceId;
		try {
			const result = await invoke<ScreenCaptureResult>("screen_share_capture");
			// A stop (or a new source) may have won while capture was in flight.
			if (!get().active || get().sourceId !== sourceId) return;
			const patch: Partial<ScreenShareState> = { version: result.version, error: "" };
			if (result.frame) {
				patch.preview = screenFrameDataUrl(result.frame);
				patch.sourceName = result.frame.sourceName;
			}
			set(patch);
		} catch (error) {
			stopPolling();
			void invoke("screen_share_stop").catch(() => undefined);
			set({
				active: false,
				preview: null,
				version: 0,
				error: errorMessage(error),
			});
		} finally {
			pollInFlight = false;
		}
	}

	function startPolling(): void {
		stopPolling();
		pollTimer = window.setInterval(() => void poll(), POLL_MS);
		void poll();
	}

	return {
		active: false,
		permission: true,
		sources: [],
		sourceId: null,
		sourceName: "",
		preview: null,
		version: 0,
		error: "",
		busy: false,

		async listSources() {
			const result = await invoke<ScreenSources>("screen_share_sources");
			set({ sources: result.sources, permission: result.permission });
			return result;
		},

		async requestPermission() {
			try {
				const permission = await invoke<boolean>("screen_share_request_permission");
				set({ permission });
				return permission;
			} catch (error) {
				set({ error: errorMessage(error) });
				return false;
			}
		},

		async refreshStatus() {
			try {
				const status = await invoke<ScreenStatus>("screen_share_status");
				set({
					active: status.active,
					permission: status.permission,
					sourceId: status.sourceId,
					sourceName: status.sourceName ?? "",
					version: status.version,
				});
			} catch (error) {
				set({ error: errorMessage(error) });
			}
		},

		async start(sourceId) {
			set({ busy: true, error: "" });
			try {
				const status = await invoke<ScreenStatus>("screen_share_start", { sourceId });
				lastAttachedVersion = -1;
				lastAttachedAt = 0;
				set({
					active: status.active,
					permission: status.permission,
					sourceId: status.sourceId ?? sourceId,
					sourceName: status.sourceName ?? "",
					preview: null,
					version: status.version,
					busy: false,
				});
				startPolling();
				return true;
			} catch (error) {
				set({ busy: false, error: errorMessage(error) });
				return false;
			}
		},

		async stop() {
			stopPolling();
			lastAttachedVersion = -1;
			lastAttachedAt = 0;
			await invoke("screen_share_stop").catch(() => undefined);
			set({
				active: false,
				sourceId: null,
				sourceName: "",
				preview: null,
				version: 0,
				error: "",
				busy: false,
			});
		},

		async captureForTurn() {
			if (!get().active) return null;
			try {
				const frame = await invoke<ScreenFrame>("screen_share_latest");
				set({
					preview: screenFrameDataUrl(frame),
					sourceName: frame.sourceName,
					version: frame.version,
					error: "",
				});
				const now = Date.now();
				if (!shouldAttachScreenFrame(frame.version, lastAttachedVersion, lastAttachedAt, now)) {
					return null;
				}
				lastAttachedVersion = frame.version;
				lastAttachedAt = now;
				return { type: "image", data: frame.base64, mimeType: frame.mimeType };
			} catch (error) {
				set({ error: errorMessage(error) });
				return null;
			}
		},
	};
});

export const screenShare = useScreenShareStore.getState();
