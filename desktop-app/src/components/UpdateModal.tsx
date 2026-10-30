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
import { Button } from "./ui/Button";
import { IconButton } from "./ui/Button";
import { ModalBackdrop, ModalPanel } from "./ui/Modal";

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
		error,
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
		<ModalBackdrop
			ref={modalRef}
			aria-label="Update available"
			onClick={handleDismiss}
		>
			<ModalPanel
				className="max-w-md"
				centered={false}
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
						<p className="mt-0.5 text-2xs text-pi-text-muted">
							A new version of A-Coder is ready to install
						</p>
					</div>
					<IconButton
						variant="ghost"
						size="sm"
						icon={X}
						onClick={handleDismiss}
						aria-label="Dismiss"

					/>
				</div>

				{/* Body */}
				<div className="px-4 py-4">
					{/* Version badge row */}
					<div className="flex items-center gap-3 text-xs">
						<span className="rounded bg-pi-accent-soft px-2 py-0.5 font-mono text-pi-accent">
							{versionLabel}
						</span>
						<span className="text-pi-text-muted">from {currentVersionLabel}</span>
					</div>

					{/* Download progress bar */}
					{isDownloading && (
						<div className="mt-4">
							<div className="flex items-center justify-between text-2xs text-pi-text-muted mb-1.5">
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
							<span className="text-xs">Update downloaded. Restart to install.</span>
						</div>
					)}

					{/* Error state */}
					{hasError && (
						<div className="mt-4 rounded-lg border border-pi-error/20 bg-pi-error-soft px-3 py-2">
							<p className="text-xs text-pi-error">
								Update failed. Check your internet connection and try again.
							</p>
							{error && (
								<p className="mt-1 break-words font-mono text-2xs text-pi-error/80">{error}</p>
							)}
						</div>
					)}

					{/* Release notes: the updater manifest's notes field (markdown sent
						as plain text). Open by default; hint when the release was built
						without notes. */}
					{!isDownloading && !isReady && (
						<div className="mt-4">
							<div className="text-2xs font-semibold uppercase tracking-[0.08em] text-pi-text-faint">
								What's new in {versionLabel}
							</div>
							{update.body ? (
								<div className="mt-2 max-h-56 overflow-y-auto rounded-lg bg-pi-surface-raised p-3">
									<ReleaseNotes body={update.body} />
								</div>
							) : (
								<p className="mt-2 text-xs text-pi-text-faint">
									Full notes are on the release page once published.
								</p>
							)}
						</div>
					)}
				</div>

				{/* Footer */}
				<div className="flex items-center justify-end gap-2 border-t border-pi-border px-4 py-3">
					<Button variant="ghost" size="md" onClick={handleDismiss}>
						Later
					</Button>
					{isReady ? (
						<Button
							variant="primary"
							size="md"
							icon={RefreshCw}
							onClick={handleRelaunch}
						>
							Restart to install
						</Button>
					) : hasError ? (
						<Button
							variant="primary"
							size="md"
							icon={Download}
							onClick={handleDownload}
						>
							Try again
						</Button>
					) : (
						<Button
							variant="primary"
							size="md"
							icon={Download}
							loading={isDownloading}
							onClick={handleDownload}
						>
							{isDownloading ? "Downloading..." : "Download update"}
						</Button>
					)}
				</div>
			</ModalPanel>
		</ModalBackdrop>
	);
}
/**
 * Release-notes renderer for the updater manifest's `notes` field. The notes
 * are markdown (same text as the GitHub release body) but rendered here as
 * styled plain text — headings, bullets, bold and inline code get the house
 * treatment; nothing else is parsed, so nothing can inject layout surprises.
 */
function ReleaseNotes({ body }: { body: string }): React.ReactNode {
	const blocks = body.split("\n").map((line) => line.trimEnd());
	const nodes: React.ReactNode[] = [];
	for (let index = 0; index < blocks.length; index++) {
		const line = blocks[index]!;
		if (!line.trim()) continue;

		// Headings: "# Title", "## Section"…
		const heading = /^(#{1,4})\s+(.*)$/.exec(line);
		if (heading) {
			nodes.push(
				<div
					key={index}
					className="mt-2.5 text-2xs font-semibold tracking-tight text-pi-text first:mt-0"
				>
					{inlineNodes(heading[2]!)}
				</div>,
			);
			continue;
		}

		// Bullets: "- item", "* item", "1. item"
		const bullet = /^\s*(?:[-*]|\d+[.)])\s+(.*)$/.exec(line);
		if (bullet) {
			nodes.push(
				<div key={index} className="flex gap-2 pl-1">
					<span className="mt-0.5 select-none text-pi-accent">•</span>
					<span className="min-w-0 flex-1">{inlineNodes(bullet[1]!)}</span>
				</div>,
			);
			continue;
		}

		// Everything else: paragraph line.
		nodes.push(
			<p key={index} className="text-xs leading-relaxed text-pi-text-secondary">
				{inlineNodes(line)}
			</p>,
		);
	}
	return <div className="flex flex-col gap-1">{nodes}</div>;
}

/** Minimal inline markdown: **bold**, `code`, and bare links (display only). */
function inlineNodes(text: string): React.ReactNode {
	const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/\S+)/g).filter(Boolean);
	return parts.map((part, index) => {
		if (part.startsWith("**") && part.endsWith("**")) {
			return (
				<span key={index} className="font-semibold text-pi-text">
					{part.slice(2, -2)}
				</span>
			);
		}
		if (part.startsWith("`") && part.endsWith("`")) {
			return (
				<code key={index} className="rounded bg-pi-bg px-1 py-0.5 font-mono text-3xs text-pi-accent">
					{part.slice(1, -1)}
				</code>
			);
		}
		if (/^https?:\/\//.test(part)) {
			return (
				<a key={index} href={part} target="_blank" rel="noopener noreferrer" className="break-all text-pi-accent underline decoration-pi-accent/40">
					{part.replace(/^https?:\/\/(?:www\.)?/, "")}
				</a>
			);
		}
		return <span key={index}>{part}</span>;
	});
}
