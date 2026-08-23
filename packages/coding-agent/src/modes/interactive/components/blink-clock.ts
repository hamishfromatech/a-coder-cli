/**
 * Shared blink clock for in-flight tool status dots.
 *
 * Mirrors easy-agent's useBlink: while a tool is unresolved its `●` status
 * dot blinks. A single module-level timer drives every subscriber — no one
 * interval per card — so N running tools cost one timer and one render per
 * tick. The timer only runs while at least one subscriber is active, and
 * stops itself when the last one unsubscribes.
 *
 * Adapted to pi-tui: components read `isBlinkVisible()` during render and
 * register the TUI instance so each tick triggers `requestRender()`.
 * TUI instances are reference-counted so multiple components sharing one
 * TUI keep the clock running until the last one unsubscribes.
 */

import type { TUI } from "@earendil-works/pi-tui";

const BLINK_MS = 480;

let visible = true;
let timer: ReturnType<typeof setInterval> | null = null;
const tuiRefCounts = new Map<TUI, number>();

function start(): void {
	if (timer) return;
	timer = setInterval(() => {
		visible = !visible;
		for (const tui of tuiRefCounts.keys()) {
			tui.requestRender();
		}
	}, BLINK_MS);
}

function stopIfIdle(): void {
	if (tuiRefCounts.size === 0 && timer) {
		clearInterval(timer);
		timer = null;
		visible = true; // reset so the next running dot starts solid
	}
}

/**
 * Register a TUI instance to receive render ticks while any dot is active.
 * Returns an unsubscribe function. Multiple components may subscribe the
 * same TUI; the clock stops only when the last subscription is released.
 */
export function subscribeBlink(tui: TUI): () => void {
	const count = tuiRefCounts.get(tui) ?? 0;
	tuiRefCounts.set(tui, count + 1);
	start();
	let unsubscribed = false;
	return () => {
		if (unsubscribed) return;
		unsubscribed = true;
		const current = tuiRefCounts.get(tui) ?? 0;
		if (current <= 1) {
			tuiRefCounts.delete(tui);
		} else {
			tuiRefCounts.set(tui, current - 1);
		}
		stopIfIdle();
	};
}

/**
 * Whether the dot should be drawn this frame. Call during render.
 * When no timer is running (no active subscribers), returns true (solid).
 */
export function isBlinkVisible(): boolean {
	return visible;
}
