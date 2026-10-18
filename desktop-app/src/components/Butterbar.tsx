import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNoticeStore, type Notice } from "../stores/notice-store";

/**
 * The butterbar: one strip above the status bar for notices that are still
 * true (not events that already happened). Notices rotate on a 3 s dwell with
 * dots for the rest; hovering pauses the rotation so a long message can be
 * read. Tone is one CSS variable — the strip never invents per-notice colors.
 */

const DWELL_MS = 3000;

const TONE_VAR: Record<Notice["tone"], string> = {
	info: "var(--pi-accent)",
	success: "var(--pi-success)",
	warning: "var(--pi-warning)",
	error: "var(--pi-error)",
};

const TONE_ICON = {
	info: Info,
	success: CheckCircle2,
	warning: AlertTriangle,
	error: AlertTriangle,
} as const;

export function Butterbar() {
	const notices = useNoticeStore((s) => s.notices);
	const remove = useNoticeStore((s) => s.remove);
	const dismissForever = useNoticeStore((s) => s.dismissForever);
	const [index, setIndex] = useState(0);
	const [paused, setPaused] = useState(false);
	const lastCount = useRef(notices.length);

	const ordered = useMemo(
		() => [...notices].sort((a, b) => b.priority - a.priority),
		[notices],
	);

	// A notice list change shouldn't leave the cursor past the end (and a
	// newly arrived higher-priority notice should surface immediately).
	useEffect(() => {
		if (notices.length !== lastCount.current) {
			lastCount.current = notices.length;
			setIndex(0);
			setPaused(false);
		}
	}, [notices.length]);

	useEffect(() => {
		if (paused || ordered.length <= 1) return;
		const timer = window.setInterval(() => {
			setIndex((current) => (current + 1) % ordered.length);
		}, DWELL_MS);
		return () => window.clearInterval(timer);
	}, [paused, ordered.length]);

	if (ordered.length === 0) return null;

	const current = ordered[Math.min(index, ordered.length - 1)]!;
	const Icon = TONE_ICON[current.tone];

	return (
		<div
			role="status"
			aria-live="polite"
			className="flex items-center gap-2 border-t border-pi-border px-3 py-1.5"
			style={{
				// One tone variable drives border, background tint, and icon.
				["--notice-tone" as string]: TONE_VAR[current.tone],
				background: "color-mix(in srgb, var(--notice-tone) 8%, transparent)",
			}}
			onPointerEnter={() => setPaused(true)}
			onPointerLeave={() => setPaused(false)}
		>
			<Icon className="h-3.5 w-3.5 shrink-0" style={{ color: "var(--notice-tone)" }} aria-hidden />
			<div className="min-w-0 flex-1">
				<span className="text-2xs font-medium text-pi-text">{current.title}</span>
				{current.message && (
					<span className="ml-2 text-2xs text-pi-text-muted">{current.message}</span>
				)}
			</div>

			{ordered.length > 1 && (
				<div className="flex shrink-0 items-center gap-1" aria-label={`Notice ${index + 1} of ${ordered.length}`}>
					{ordered.map((n, i) => (
						<button
							key={n.id}
							type="button"
							onClick={() => setIndex(i)}
							className="h-1.5 w-1.5 rounded-full transition-opacity focus-visible:shadow-focus focus-visible:outline-none"
							style={{
								background: "var(--notice-tone)",
								opacity: i === index ? 1 : 0.35,
							}}
							aria-label={n.title}
							aria-current={i === index}
						/>
					))}
				</div>
			)}

			{current.action && (
				<button
					type="button"
					onClick={current.action.onSelect}
					className="shrink-0 rounded-md px-2 py-0.5 text-2xs font-medium text-pi-text transition-hover hover:bg-pi-surface-raised focus-visible:shadow-focus focus-visible:outline-none"
				>
					{current.action.label}
				</button>
			)}
			{current.secondaryAction && (
				<button
					type="button"
					onClick={current.secondaryAction.onSelect}
					className="shrink-0 rounded-md px-2 py-0.5 text-2xs text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
				>
					{current.secondaryAction.label}
				</button>
			)}

			<button
				type="button"
				onClick={() => {
					// X = not now. Persistent notices are only silenced by their
					// explicit "don't show again" action, so a slip of the mouse
					// doesn't lose an auth problem forever.
					remove(current.id);
					setIndex(0);
				}}
				className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-pi-text-faint transition-hover hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
				aria-label="Dismiss notice"
			>
				<X className="h-3 w-3" />
			</button>
			{current.persistKey && (
				<button
					type="button"
					onClick={() => dismissForever(current)}
					className="shrink-0 text-3xs text-pi-text-faint underline-offset-2 transition-hover hover:text-pi-text hover:underline focus-visible:shadow-focus focus-visible:outline-none"
				>
					Don&apos;t show again
				</button>
			)}
		</div>
	);
}
