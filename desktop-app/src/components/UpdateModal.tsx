/**
 * Update notification modal for the desktop app.
 *
 * Surfaces when `useUpdateStore` reports an available update. Shows the new
 * version, optional release notes, a progress bar during download, and a
 * "Restart to install" button once the update is ready.
 *
 * The modal is not auto-shown for dismissed versions; users can re-trigger a
 * check via the menu.
 */

import { useRef, useCallback } from "react";
import { Download, RefreshCw, X, Check, Sparkles } from "lucide-react";
import { useModalA11y } from "../hooks/useModalA11y";
import { useUpdateStore } from "../stores/update-store";
import {
	downloadAndInstallUpdate,
	relaunchApp,
	type UpdateInfo,
} from "../lib/updater";

export interface UpdateModalProps {
	/** Update info from the store. */
	update: UpdateInfo;
	/** Called when the modal is dismissed. */
	onDismiss: () => void;
}

export function UpdateModal({ update, onDismiss }: UpdateModalProps) {
	const modalRef = useRef<HTMLDivElement>(null);
	const {
		status,
		downloadedBytes,
		totalBytes,
		setStatus,
		setError,
		setProgress,
	} = useUpdateStore();

	useModalA11y(modalRef, true, onDismiss);

	const handleDownload = useCallback(async () => {
		setStatus("downloading");
		setError(null);
		try {
			await downloadAndInstallUpdate((event) => {
				setProgress(event);
			});
			setStatus("ready-to-relaunch");
		} catch (e) {
			setStatus("error");
			setError(e instanceof Error ? e.message : String(e));
		}
	}, [setProgress, setStatus, setError]);

	const handleRelaunch = useCallback(async () => {
		try {
			await relaunchApp();
		} catch (e) {
			setStatus("error");
			setError(e instanceof Error ? e.message : String(e));
		}
	}, [setStatus, setError]);

	const handleDismiss = useCallback(() => {
		onDismiss();
	}, [onDismiss]);

	const progressPercent =
		totalBytes && totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : null;
	const isDownloading = status === "downloading";
	const isReady = status === "ready-to-relaunch";
	const hasError = status === "error";

	// Format version as "v0.80.5" style.
	const versionLabel = `v${update.version}`;
	const currentVersionLabel = `v${update.currentVersion}`;

	return (
		<div
			ref={modalRef}
			role="dialog"
			aria-modal="true"
			aria-label="Update available"
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
			onClick={handleDismiss}
		>
			<div
				className="flex w-full max-w-md flex-col overflow-hidden rounded-xl bg-pi-surface-overlay shadow-overlay"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="flex items-center gap-3 border-b border-pi-border px-4 py-3">
					<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-pi-accent-soft text-pi-accent">
						<Sparkles className="h-4 w-4" />
					</div>
					<div className="min-w-0 flex-1">
						<h2 className="text-[13px] font-semibold tracking-tight text-pi-text">
							Update available
						</h2>
						<p className="mt-0.5 text-[11px] text-pi-text-muted">
							A new version of A-Coder is ready to install
						</p>
					</div>
					<button
						onClick={handleDismiss}
						className="rounded p-1 text-pi-text-muted transition-hover active-press hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
						title="Dismiss"
						aria-label="Dismiss"
					>
						<X className="h-3.5 w-3.5" />
					</button>
				</div>

				{/* Body */}
				<div className="px-4 py-4">
					{/* Version badge row */}
					<div className="flex items-center gap-3 text-[12px]">
						<span className="rounded bg-pi-accent-soft px-2 py-0.5 font-mono text-pi-accent">
							{versionLabel}
						</span>
						<span className="text-pi-text-muted">from {currentVersionLabel}</span>
					</div>

					{/* Download progress bar */}
					{isDownloading && (
						<div className="mt-4">
							<div className="flex items-center justify-between text-[11px] text-pi-text-muted mb-1.5">
								<span>Downloading update...</span>
								{progressPercent !== null && (
									<span>{Math.round(progressPercent)}%</span>
								)}
							</div>
							<div className="h-2 rounded-full bg-pi-surface-raised overflow-hidden">
								<div
									className="h-full bg-pi-accent transition-all duration-300"
									style={{ width: progressPercent !== null ? `${progressPercent}%` : "0%" }}
								/>
							</div>
						</div>
					)}

					{/* Ready state */}
					{isReady && (
						<div className="mt-4 flex items-center gap-2 rounded-lg bg-pi-success/10 px-3 py-2 text-pi-success">
							<Check className="h-3.5 w-3.5 shrink-0" />
							<span className="text-[12px]">Update downloaded. Restart to install.</span>
						</div>
					)}

					{/* Error state */}
					{hasError && (
						<div className="mt-4 rounded-lg border border-pi-error/20 bg-pi-error-soft px-3 py-2">
							<p className="text-[12px] text-pi-error">
								Update failed. Check your internet connection and try again.
							</p>
						</div>
					)}

					{/* Release notes (collapsed by default, optional) */}
					{update.body && !isDownloading && !isReady && (
						<details className="mt-4">
							<summary className="cursor-pointer text-[12px] text-pi-text-muted transition-hover hover:text-pi-text-secondary focus-visible:shadow-focus focus-visible:outline-none">
								View release notes
							</summary>
							<div className="mt-2 max-h-48 overflow-y-auto rounded-lg bg-pi-surface-raised p-3">
								<p className="text-[12px] leading-relaxed text-pi-text-secondary whitespace-pre-wrap">
									{update.body}
								</p>
							</div>
						</details>
					)}
				</div>

				{/* Footer */}
				<div className="flex items-center justify-end gap-2 border-t border-pi-border px-4 py-3">
					<button
						onClick={handleDismiss}
						className="rounded-lg px-3 py-2 text-[12px] font-medium text-pi-text-secondary transition-hover active-press hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
					>
						Later
					</button>
					{isReady ? (
						<button
							onClick={handleRelaunch}
							className="inline-flex items-center gap-1.5 rounded-lg bg-pi-accent px-3 py-2 text-[12px] font-medium text-white shadow-ring-accent transition-hover active-press hover:bg-pi-accent-hover focus-visible:shadow-focus focus-visible:outline-none"
						>
							<RefreshCw className="h-3.5 w-3.5" />
							Restart to install
						</button>
					) : hasError ? (
						<button
							onClick={handleDownload}
							className="inline-flex items-center gap-1.5 rounded-lg bg-pi-accent px-3 py-2 text-[12px] font-medium text-white shadow-ring-accent transition-hover active-press hover:bg-pi-accent-hover focus-visible:shadow-focus focus-visible:outline-none"
						>
							<Download className="h-3.5 w-3.5" />
							Try again
						</button>
					) : (
						<button
							onClick={handleDownload}
							disabled={isDownloading}
							className="inline-flex items-center gap-1.5 rounded-lg bg-pi-accent px-3 py-2 text-[12px] font-medium text-white shadow-ring-accent transition-hover active-press hover:bg-pi-accent-hover focus-visible:shadow-focus focus-visible:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
						>
							<Download className="h-3.5 w-3.5" />
							{isDownloading ? "Downloading..." : "Download update"}
						</button>
					)}
				</div>
			</div>
		</div>
	);
}