/**
 * Reduced-motion preference (easy-agent motionPrefs parity).
 *
 * Animated UI (spinner frames, shimmer sweeps, blink clocks) reads this
 * module-level flag rather than re-reading settings, because component render
 * is sync and frequent. The host snapshots the setting at startup. When on,
 * animated components render a calm static frame instead.
 */

let reducedMotion = false;

export function setReducedMotion(enabled: boolean): void {
	reducedMotion = enabled;
}

export function isReducedMotion(): boolean {
	return reducedMotion;
}
