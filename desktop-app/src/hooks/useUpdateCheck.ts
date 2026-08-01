/**
 * Hook to check for updates on mount and surface the result via the update store.
 *
 * Runs once on app startup (or after the CLI connects), checking the configured
 * endpoints for a new version. If an update is available and the user hasn't
 * dismissed it in this session, the modal will show.
 *
 * Errors during the check are swallowed silently in dev; in prod they may be
 * toasted by the caller if desired.
 */

import { useCallback, useEffect, useRef } from "react";
import { useUpdateStore } from "../stores/update-store";
import { checkForUpdate } from "../lib/updater";

/**
 * Check for updates on mount and update the store accordingly.
 *
 * @param options.enabled - Set false to skip the check (e.g. when offline).
 * @param options.onAvailable - Optional callback when an update is found.
 * @param options.onError - Optional callback when the check fails.
 * @param options.onUpToDate - Optional callback when no update is available.
 */
export function useUpdateCheck(options?: {
	enabled?: boolean;
	onAvailable?: (version: string) => void;
	onError?: (error: Error) => void;
	onUpToDate?: () => void;
}): void {
	const { enabled = true, onAvailable, onError, onUpToDate } = options ?? {};
	const { setStatus, setUpdate, setError, dismissedVersion } =
		useUpdateStore();
	const checkedRef = useRef(false);

	const runCheck = useCallback(
		async (opts?: { force?: boolean }) => {
			const { force = false } = opts ?? {};
			setStatus("checking");
			try {
				const result = await checkForUpdate();
				if (result.available && result.update) {
					// Don't re-show if the user already dismissed this version,
					// unless this is a forced check (menu action).
					if (!force && dismissedVersion === result.update.version) {
						setStatus("idle");
						return;
					}
					// If forced, clear the dismissal so the modal shows again.
					setUpdate(result.update);
					setStatus("available");
					onAvailable?.(result.update.version);
				} else {
					setStatus("up-to-date");
					onUpToDate?.();
				}
			} catch (e) {
				const err = e instanceof Error ? e : new Error(String(e));
				setStatus("idle");
				setError(null);
				onError?.(err);
			}
		},
		[dismissedVersion, setStatus, setUpdate, setError, onAvailable, onError, onUpToDate],
	);

	// Auto-check on mount.
	useEffect(() => {
		if (!enabled || checkedRef.current) return;
		checkedRef.current = true;
		void runCheck();
	}, [enabled, runCheck]);

	// Listen for manual check requests (menu action, keyboard shortcut).
	useEffect(() => {
		const handler = () => {
			void runCheck({ force: true });
		};
		window.addEventListener("a-coder:check-updates", handler);
		return () => window.removeEventListener("a-coder:check-updates", handler);
	}, [runCheck]);
}

/**
 * Manually trigger an update check (e.g. from a menu item).
 */
export function triggerUpdateCheck(): void {
	// Dispatch a custom event that App.tsx listens for.
	window.dispatchEvent(new CustomEvent("a-coder:check-updates"));
}