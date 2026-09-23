/**
 * Settings → Updates: the current app version, a manual update check, and
 * the last-checked time. When a check finds an update, it hands off to the
 * store's "available" state so the existing UpdateModal (download progress,
 * relaunch) takes over — the same flow the menu and startup check use.
 */

import { useCallback, useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { AlertCircle, Check, Loader2, RefreshCw } from "lucide-react";
import { Button } from "../../ui/Button";
import { useUpdateStore } from "../../../stores/update-store";
import { checkForUpdate } from "../../../lib/updater";

const LAST_CHECKED_KEY = "a-coder-updates-last-checked";

function relativeCheckedLabel(iso: string): string {
	const delta = Date.now() - new Date(iso).getTime();
	if (delta < 60_000) return "just now";
	if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
	if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
	return `${Math.floor(delta / 86_400_000)}d ago`;
}

export function UpdatesSection() {
	const [currentVersion, setCurrentVersion] = useState<string | null>(null);
	const [checkedAt, setCheckedAt] = useState<string | null>(() => {
		try {
			return localStorage.getItem(LAST_CHECKED_KEY);
		} catch {
			return null;
		}
	});
	const { status, error, setStatus, setUpdate, setError } = useUpdateStore();

	useEffect(() => {
		void getVersion()
			.then(setCurrentVersion)
			.catch(() => setCurrentVersion(null));
	}, []);

	const runCheck = useCallback(async () => {
		setStatus("checking");
		try {
			const result = await checkForUpdate();
			if (result.available && result.update) {
				setUpdate(result.update);
				setStatus("available");
			} else {
				setStatus("up-to-date");
			}
			const now = new Date().toISOString();
			try {
				localStorage.setItem(LAST_CHECKED_KEY, now);
			} catch {
				// private mode etc. — the label just stays stale
			}
			setCheckedAt(now);
		} catch (e) {
			setStatus("error");
			setError(e instanceof Error ? e.message : String(e));
		}
	}, [setError, setStatus, setUpdate]);

	const checking = status === "checking";
	const upToDate = status === "up-to-date";
	const failed = status === "error" && error !== null;

	return (
		<section className="space-y-3">
			<div className="overflow-hidden rounded-lg border border-pi-border bg-pi-surface-raised">
				{/* Current version row */}
				<div className="flex items-center justify-between gap-4 px-3.5 py-3">
					<div className="min-w-0">
						<div className="text-xs font-medium text-pi-text">Current version</div>
						<div className="mt-0.5 text-2xs text-pi-text-muted">
							{currentVersion ? `A-Coder Desktop v${currentVersion}` : "A-Coder Desktop"}
						</div>
					</div>
					<Button
						variant="secondary"
						size="sm"
						icon={checking ? Loader2 : RefreshCw}
						disabled={checking}
						onClick={() => void runCheck()}
					>
						{checking ? "Checking…" : "Check for updates"}
					</Button>
				</div>

				{/* Result strip */}
				{upToDate && (
					<div className="flex items-center gap-2 border-t border-pi-border px-3.5 py-2.5 text-2xs text-pi-text-muted">
						<Check className="h-3.5 w-3.5 shrink-0 text-pi-success" />
						<span>You're up to date.</span>
						{checkedAt && (
							<span className="text-pi-text-faint">
								Checked {relativeCheckedLabel(checkedAt)}
							</span>
						)}
					</div>
				)}
				{failed && (
					<div className="flex items-start gap-2 border-t border-pi-border px-3.5 py-2.5 text-2xs text-pi-text-muted">
						<AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pi-warning" />
						<div className="min-w-0">
							<div>Couldn't check for updates.</div>
							{error && <div className="mt-0.5 break-words text-pi-text-faint">{error}</div>}
						</div>
					</div>
				)}
			</div>

			<p className="px-0.5 text-2xs leading-relaxed text-pi-text-faint">
				Updates download in a window over this one and install after a restart. A-Coder
				also checks automatically on launch.
			</p>
		</section>
	);
}