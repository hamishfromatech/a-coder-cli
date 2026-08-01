/**
 * Auto-update wrapper around @tauri-apps/plugin-updater.
 *
 * The Tauri updater plugin is configured in src-tauri/tauri.conf.json to point
 * at the latest GitHub release artifact (`latest.json`). This module exposes a
 * small typed surface for the React UI to:
 *   - check for an available update
 *   - download + install it with progress events
 *   - relaunch the app after install
 *
 * In dev builds (or when the updater is unconfigured), `checkForUpdate` resolves
 * to `{ available: false }` so the UI can no-op gracefully.
 */

import { check, type Update, type DownloadEvent } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";

export interface UpdateInfo {
	/** Version string of the available update (e.g. "0.81.0"). */
	version: string;
	/** Current running version. */
	currentVersion: string;
	/** Release date in ISO 8601, if provided by the manifest. */
	date?: string;
	/** Release notes body (markdown) if provided by the manifest. */
	body?: string;
}

export type DownloadProgress =
	| { kind: "started"; contentLength?: number }
	| { kind: "progress"; chunkLength: number; totalDownloaded: number; contentLength?: number }
	| { kind: "finished" };

export interface UpdateCheckResult {
	available: boolean;
	update?: UpdateInfo;
}

/**
 * Check the configured endpoints for an available update.
 * Returns `{ available: false }` when the app is up-to-date.
 *
 * Throws on errors (e.g. network failure, dev build without updater config)
 * so callers can decide whether to log or toast it.
 */
export async function checkForUpdate(): Promise<UpdateCheckResult> {
	let update: Update | null;
	try {
		update = await check();
	} catch (e) {
		throw new Error(
			`Update check failed: ${e instanceof Error ? e.message : String(e)}`,
		);
	}

	if (!update) {
		return { available: false };
	}

	const info: UpdateInfo = {
		version: update.version,
		currentVersion: update.currentVersion,
		date: update.date,
		body: update.body,
	};

	// Release the Update resource; we'll re-fetch it when installing.
	// Keeping it alive across the React render cycle would leak the resource
	// and complicate state management.
	try {
		await update.close();
	} catch {
		// best-effort
	}

	return { available: true, update: info };
}

/**
 * Download and install the pending update, streaming progress events to the
 * callback. After the install completes, callers should prompt the user to
 * relaunch (or call `relaunchApp` directly).
 *
 * Re-checks for the update each call so the pending `Update` object is fresh.
 */
export async function downloadAndInstallUpdate(
	onProgress: (event: DownloadProgress) => void,
): Promise<void> {
	const update = await check();
	if (!update) {
		throw new Error("No update available to install.");
	}

	let totalDownloaded = 0;
	let contentLength: number | undefined;

	const handleEvent = (event: DownloadEvent) => {
		switch (event.event) {
			case "Started": {
				contentLength = event.data.contentLength;
				onProgress({ kind: "started", contentLength });
				break;
			}
			case "Progress": {
				totalDownloaded += event.data.chunkLength ?? 0;
				onProgress({
					kind: "progress",
					chunkLength: event.data.chunkLength ?? 0,
					totalDownloaded,
					contentLength,
				});
				break;
			}
			case "Finished": {
				onProgress({ kind: "finished" });
				break;
			}
		}
	};

	await update.downloadAndInstall(handleEvent);
}

/** Relaunch the app using the process plugin. Required after install. */
export async function relaunchApp(): Promise<void> {
	await relaunch();
}
