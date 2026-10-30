/**
 * Draggable divider for IDE panes (terminal height, sidebar width).
 * Pointer-capture based: snapshots the pane size at drag start, then reports
 * ABSOLUTE next sizes toward the positive axis (right / down), so drags stay
 * smooth regardless of React render timing. The caller clamps.
 */

import { useCallback, useRef, type ReactNode, type PointerEvent as ReactPointerEvent } from "react";

export interface ResizeHandleProps {
	/** "horizontal" = a vertical strip between columns (drag controls width);
	 * "vertical" = a horizontal strip between stacked rows (drag controls height). */
	orientation: "horizontal" | "vertical";
	/** Current pane size (width for horizontal, height for vertical). */
	value: number;
	/** Increase per pixel: -1 when dragging toward the negative axis means growing
	 * (e.g. a bottom-docked terminal dragged upward grows). */
	step?: 1 | -1;
	/** Absolute next size; the caller clamps and persists. */
	onResize: (next: number) => void;
	className?: string;
	ariaLabel: string;
}

export function ResizeHandle({ orientation, value, step = 1, onResize, className, ariaLabel }: ResizeHandleProps): ReactNode {
	const dragging = useRef(false);
	const startPos = useRef(0);
	const startValue = useRef(0);

	if (!Number.isFinite(value)) return null;

	const onPointerDown = useCallback(
		(event: ReactPointerEvent): void => {
			event.preventDefault();
			dragging.current = true;
			startPos.current = orientation === "horizontal" ? event.clientX : event.clientY;
			startValue.current = value;
			event.currentTarget.setPointerCapture(event.pointerId);
		},
		[orientation, value],
	);

	const onPointerMove = useCallback(
		(event: ReactPointerEvent): void => {
			if (!dragging.current) return;
			const pos = orientation === "horizontal" ? event.clientX : event.clientY;
			const raw = startValue.current + (pos - startPos.current) * step;
			if (Number.isFinite(raw)) onResize(raw);
		},
		[orientation, step, onResize],
	);

	const onPointerUp = useCallback((event: ReactPointerEvent): void => {
		dragging.current = false;
		event.currentTarget.releasePointerCapture(event.pointerId);
	}, []);

	return (
		<div
			role="separator"
			aria-label={ariaLabel}
			aria-orientation={orientation === "horizontal" ? "vertical" : "horizontal"}
			onPointerDown={onPointerDown}
			onPointerMove={onPointerMove}
			onPointerUp={onPointerUp}
			className={className}
			style={{ touchAction: "none" }}
		/>
	);
}

export const clampSize = (value: number, min: number, max: number): number =>
	Math.max(min, Math.min(max, value));