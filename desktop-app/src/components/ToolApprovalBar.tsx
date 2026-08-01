import { type FC, useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ChevronDown, Loader2 } from "lucide-react";
import { useSessionStore, type UiRequest } from "../stores/session-store";
import { triggerHaptic } from "../lib/haptics";

// Tool-approval bar matching Hermes desktop's in-chat permission UI.
//
// Hermes renders tool approvals as a compact, primary-tinted button strip
// inline under the pending tool row (the row already shows the command, so the
// strip doesn't repeat it), with a floating fallback card above the composer
// for when that row is scrolled out of view. This component implements both
// surfaces; the inline surface reports its on-screen visibility so the floating
// fallback only mounts when the inline bar isn't visible.
//
// Binding is positional, not command-matched: the agent blocks on a single
// approval at a time, so the pending tool row IS the row that raised it. The
// reason text comes from the permission request payload.

const isMac =
	typeof navigator !== "undefined" && /Mac|iP(hone|ad|od)/.test(navigator.platform);

type ApprovalChoice = "allow" | "deny";

interface ToolApprovalBarProps {
	request: UiRequest;
	surface: "inline" | "floating";
}

export const ToolApprovalBar: FC<ToolApprovalBarProps> = ({ request, surface }) => {
	const resolveUiRequest = useSessionStore((s) => s.resolveUiRequest);
	const setApprovalInlineVisible = useSessionStore((s) => s.setApprovalInlineVisible);
	const [submitting, setSubmitting] = useState<ApprovalChoice | null>(null);
	const [showDetails, setShowDetails] = useState(false);
	const inlineRef = useRef<HTMLDivElement | null>(null);

	const busy = submitting !== null;
	const hasDetails = (request.message ?? "").trim().length > 0;

	const respond = useCallback(
		(choice: ApprovalChoice) => {
			// Another bar (or the keyboard path) may have already resolved this
			// approval; the store is the single source of truth, so bail if the
			// request is gone.
			if (busy) return;
			const stillPending = useSessionStore
				.getState()
				.uiRequests.some((r) => r.id === request.id);
			if (!stillPending) return;

			setSubmitting(choice);
			triggerHaptic(choice === "deny" ? "cancel" : "submit");
			resolveUiRequest(request.id, { confirmed: choice === "allow" });
		},
		[busy, request.id, resolveUiRequest],
	);

	// Inline surface: report on-screen visibility so the floating fallback only
	// appears when this bar is scrolled out of view.
	useEffect(() => {
		if (surface !== "inline") return;
		const el = inlineRef.current;
		if (!el || typeof IntersectionObserver === "undefined") {
			setApprovalInlineVisible(true);
			return;
		}
		const observer = new IntersectionObserver(
			(entries) => {
				for (const entry of entries) {
					setApprovalInlineVisible(entry.isIntersecting);
				}
			},
			{ threshold: 0.1 },
		);
		observer.observe(el);
		return () => {
			observer.disconnect();
			setApprovalInlineVisible(false);
		};
	}, [surface, setApprovalInlineVisible]);

	// Keyboard shortcuts live at the bar so they follow whichever surface is
	// mounted. The store-guard in `respond` dedupes if both surfaces briefly
	// coexist: the first to fire resolves and clears the request, the second
	// bails. ⌘/Ctrl+Enter → allow, Esc → deny.
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				respond("allow");
			} else if (event.key === "Escape") {
				event.preventDefault();
				respond("deny");
			}
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [respond]);

	const bar = (
		<div
			className={surface === "inline" ? "mt-1 ps-5" : "mt-2"}
			data-slot={surface === "inline" ? "tool-approval-inline" : "tool-approval-actions"}
		>
			<div className="flex items-center gap-2.5">
				<div className="inline-flex h-6 items-stretch overflow-hidden rounded-md border border-pi-accent/25 bg-pi-accent-soft text-pi-accent">
					<button
						type="button"
						className="flex h-full items-center gap-1 px-2 text-xs font-medium text-pi-accent transition-smooth hover:bg-pi-accent/15 focus-visible:shadow-focus focus-visible:outline-none disabled:opacity-60"
						disabled={busy}
						onClick={() => respond("allow")}
					>
						{submitting === "allow" ? (
							<Loader2 className="h-3 w-3 animate-spin" />
						) : (
							"Allow"
						)}
						{submitting !== "allow" && (
							<span className="text-[0.625rem] text-pi-accent/60">
								{isMac ? "⌘⏎" : "Ctrl⏎"}
							</span>
						)}
					</button>
				</div>

				<button
					type="button"
					className="flex h-6 items-center gap-1.5 rounded-md px-1.5 text-xs font-normal text-pi-text-muted transition-smooth hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none disabled:opacity-60"
					disabled={busy}
					onClick={() => respond("deny")}
				>
					{submitting === "deny" ? (
						<Loader2 className="h-3 w-3 animate-spin" />
					) : (
						"Deny"
					)}
					{submitting !== "deny" && (
						<span className="text-[0.625rem] opacity-55">Esc</span>
					)}
				</button>

				{hasDetails && (
					<button
						type="button"
						aria-expanded={showDetails}
						className="flex h-6 items-center gap-1 rounded-md px-1.5 text-xs font-normal text-pi-text-muted transition-smooth hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
						onClick={() => setShowDetails((v) => !v)}
					>
						Details
						<ChevronDown
							className={`h-3 w-3 transition-transform ${showDetails ? "rotate-180" : ""}`}
						/>
					</button>
				)}
			</div>

			{showDetails && hasDetails && (
				<pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-pi-border bg-pi-surface/60 px-2.5 py-1.5 font-mono text-xs leading-snug text-pi-text-secondary">
					{request.message?.trim()}
				</pre>
			)}
		</div>
	);

	if (surface === "inline") {
		return <div ref={inlineRef}>{bar}</div>;
	}

	// Floating fallback: a centered card sitting just above the composer, shown
	// only when the inline bar is scrolled out of view.
	return (
		<div
			className="mx-auto mb-2 w-full max-w-2xl rounded-xl border border-pi-accent/30 bg-pi-surface-overlay px-3 py-2 shadow-overlay backdrop-blur-xl"
			data-slot="tool-approval-fallback"
		>
			<div className="flex min-w-0 items-center gap-2 text-sm text-pi-accent">
				<AlertCircle className="h-4 w-4 shrink-0" />
				<span className="shrink-0 font-medium">{request.title}</span>
				{request.message && (
					<span className="min-w-0 truncate text-pi-text-muted">
						{request.message}
					</span>
				)}
			</div>
			{bar}
		</div>
	);
};