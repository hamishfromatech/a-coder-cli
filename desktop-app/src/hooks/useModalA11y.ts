import { useEffect, useRef } from "react";
import { triggerHaptic } from "../lib/haptics";

const FOCUSABLE = [
	"button:not([disabled])",
	"[href]",
	"input:not([disabled])",
	"select:not([disabled])",
	"textarea:not([disabled])",
	'[tabindex]:not([tabindex="-1"])',
].join(",");

function focusFirst(container: HTMLElement) {
	const el = container.querySelector<HTMLElement>(FOCUSABLE);
	el?.focus();
}

/** Minimal modal accessibility: focus first element on open, close on Escape. */
export function useModalA11y(
	containerRef: React.RefObject<HTMLElement | null>,
	open: boolean,
	onClose: () => void,
) {
	const closeRef = useRef(onClose);
	closeRef.current = onClose;

	useEffect(() => {
		if (!open) return;
		const container = containerRef.current;
		if (container) focusFirst(container);

		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				closeRef.current();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [open, containerRef]);

	// Open/close haptic: fires on open and when the modal closes (unmount or
	// open→false). triggerHaptic is a no-op when haptics are off or unregistered.
	useEffect(() => {
		if (!open) return;
		triggerHaptic("open");
		return () => triggerHaptic("close");
	}, [open]);
}
