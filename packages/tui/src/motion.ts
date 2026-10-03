/**
 * Reduced-motion switch. When enabled, animated components (spinners, blink
 * clocks, streaming shimmer) render a calm static frame instead of ticking.
 * The agent runtime turns this on for accessibility or perf debugging.
 */
let reducedMotion = false;

export function setReducedMotion(enabled: boolean): void {
	reducedMotion = enabled;
}

export function isReducedMotion(): boolean {
	return reducedMotion;
}
