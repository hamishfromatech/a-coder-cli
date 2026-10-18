import { useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Themed tooltip. Native `title=` is banned in new UI: it opens on OS time
 * (≈1s), cannot be styled, and cannot carry a keybind label.
 *
 * Contract:
 * - ~200 ms open delay, so sweeping a toolbar doesn't trail bubbles.
 * - Re-opening within 300 ms of the last hide is instant (warm trail).
 * - Placement intents, not pixels: `control` (above a control),
 *   `toolbar` (below a toolbar button), `row` (to the right of a list row).
 * - Also opens on keyboard focus, so it is not mouse-only.
 */

export type TipPlacement = "control" | "toolbar" | "row";

const OPEN_DELAY_MS = 200;
const WARM_REOPEN_MS = 300;

let lastHideAt = 0;

const PLACEMENT: Record<TipPlacement, string> = {
	control: "bottom-full left-1/2 mb-1.5 -translate-x-1/2",
	toolbar: "top-full left-1/2 mt-1.5 -translate-x-1/2",
	row: "left-full top-1/2 ml-2 -translate-y-1/2",
};

export interface TipProps {
	content: ReactNode;
	placement?: TipPlacement;
	children: ReactNode;
	className?: string;
}

export function Tip({ content, placement = "control", children, className }: TipProps) {
	const [open, setOpen] = useState(false);
	const timer = useRef<number | null>(null);

	const clearTimer = () => {
		if (timer.current !== null) {
			window.clearTimeout(timer.current);
			timer.current = null;
		}
	};

	const show = () => {
		clearTimer();
		const warm = Date.now() - lastHideAt < WARM_REOPEN_MS;
		timer.current = window.setTimeout(() => setOpen(true), warm ? 0 : OPEN_DELAY_MS);
	};

	const hide = () => {
		clearTimer();
		setOpen((wasOpen) => {
			if (wasOpen) lastHideAt = Date.now();
			return false;
		});
	};

	useEffect(() => clearTimer, []);

	return (
		<span
			className={`relative inline-flex ${className ?? ""}`}
			onPointerEnter={show}
			onPointerLeave={hide}
			onFocusCapture={show}
			onBlurCapture={hide}
		>
			{children}
			{open && (
				<span
					role="tooltip"
					className={`pointer-events-none absolute z-popover w-max max-w-[16rem] rounded-md border border-pi-border bg-pi-surface-overlay px-2 py-1 text-2xs leading-snug text-pi-text shadow-overlay ${PLACEMENT[placement]}`}
				>
					{content}
				</span>
			)}
		</span>
	);
}

/** Keybind chip for use inside a Tip (or anywhere a shortcut is shown). */
export function Kbd({ children }: { children: ReactNode }) {
	return (
		<kbd className="ml-1.5 rounded border border-pi-border bg-pi-surface-raised px-1 py-px font-mono text-3xs text-pi-text-muted">
			{children}
		</kbd>
	);
}
