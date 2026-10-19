/**
 * Amplitude mapping shared by the mic gate and the orb meters. Sensitivity is
 * 0..1: higher lowers the speech threshold above the measured noise floor.
 */

export function clampLevel(value: number): number {
	return Math.max(0, Math.min(1, value));
}

export function micThreshold(noiseFloor: number, sensitivity: number): number {
	const spread = 0.09 - 0.055 * clampLevel(sensitivity);
	return Math.max(0.012, Math.min(0.2, noiseFloor + spread));
}

export function normalizeMicLevel(rms: number, noiseFloor: number, threshold: number): number {
	const span = Math.max(0.03, threshold * 2.4);
	return Math.min(1, Math.sqrt(Math.max(0, rms - noiseFloor) / span));
}

/** TTS playback level: boost quiet speech, clamp loud passages. */
export function normalizeOutputLevel(rms: number): number {
	return Math.min(1, Math.sqrt(Math.max(0, rms) / 0.12));
}
