/**
 * Color math shared by the theme presets and the skin applier.
 *
 * Ported from the Hermes desktop theme system (hermes-agent/apps/desktop/src/
 * themes/color.ts) so the a-coder desktop skins stay numerically identical to
 * the Hermes skins they derive from. Everything works in 6-digit `#rrggbb`;
 * `normalizeHex` is the front door for untrusted input.
 */

export function hexToRgb(hex: string): [number, number, number] | null {
	const clean = hex.trim().replace(/^#/, "");
	if (!/^[0-9a-f]{6}$/i.test(clean)) {
		return null;
	}
	return [0, 2, 4].map((i) => parseInt(clean.slice(i, i + 2), 16)) as [number, number, number];
}

export const rgbToHex = ([r, g, b]: [number, number, number]): string =>
	`#${[r, g, b]
		.map((n) =>
			Math.round(Math.min(255, Math.max(0, n)))
				.toString(16)
				.padStart(2, "0"),
		)
		.join("")}`;

export function mix(a: string, b: string, amount: number): string {
	const ar = hexToRgb(a);
	const br = hexToRgb(b);
	return ar && br
		? rgbToHex([
				ar[0] + (br[0] - ar[0]) * amount,
				ar[1] + (br[1] - ar[1]) * amount,
				ar[2] + (br[2] - ar[2]) * amount,
			])
		: a;
}

const linearize = (channel: number): number =>
	channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

/** WCAG relative luminance (gamma-corrected), 0..1. */
export function relativeLuminance(hex: string): number {
	const rgb = hexToRgb(hex);
	if (!rgb) {
		return 0;
	}
	const [r, g, b] = rgb.map((v) => linearize(v / 255));
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio (1..21) between two hex colors. */
export function contrastRatio(a: string, b: string): number {
	const la = relativeLuminance(a);
	const lb = relativeLuminance(b);
	return la >= lb ? (la + 0.05) / (lb + 0.05) : (lb + 0.05) / (la + 0.05);
}

/** Returns a readable foreground (#161616 or #ffffff) for a background hex. */
export function readableOn(hex: string): string {
	return relativeLuminance(hex) > 0.58 ? "#161616" : "#ffffff";
}

/**
 * Guarantee `color` reads against `bg`: if below `min` contrast, mix it toward
 * white (on a dark bg) or black (on a light bg) in steps until it clears,
 * keeping the hue as much as possible.
 */
export function ensureContrast(color: string, bg: string, min: number): string {
	if (contrastRatio(color, bg) >= min) {
		return color;
	}
	const towards = relativeLuminance(bg) < 0.5 ? "#ffffff" : "#000000";
	let best = color;
	for (let amount = 0.2; amount <= 1.0001; amount += 0.2) {
		best = mix(color, towards, Math.min(amount, 1));
		if (contrastRatio(best, bg) >= min) {
			return best;
		}
	}
	return best;
}

/** Perceptual-ish luminance in 0..1 (naive, for light/dark bucketing). */
export function luminance(hex: string): number {
	const rgb = hexToRgb(hex);
	if (!rgb) {
		return 0;
	}
	const [r, g, b] = rgb.map((v) => v / 255);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Convert a hex color to an `"R G B"` triplet string for `--pi-*-rgb` tokens. */
export function hexToTriplet(hex: string): string {
	const rgb = hexToRgb(hex);
	if (!rgb) {
		return "0 0 0";
	}
	return `${rgb[0]} ${rgb[1]} ${rgb[2]}`;
}