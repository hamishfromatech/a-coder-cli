/**
 * Procedural faces — a coworker's avatar derived deterministically from its
 * handle so the roster renders before any customization exists.
 *
 * Pure functions only: the desktop imports the palette + hashing and draws
 * SVG; the TUI derives the same colors for its text renderer.
 */

import type { Face, FaceShape } from "./types.ts";

/** Office palette — distinct hues tuned to read against both light and dark
 *  chrome (all ≥ 4.5:1 against white for text-on-fill use at 600-level). */
export const FACE_PALETTE = [
	"#2563eb", // blue
	"#7c3aed", // violet
	"#0891b2", // cyan
	"#059669", // emerald
	"#d97706", // amber
	"#dc2626", // red
	"#db2777", // pink
	"#4f46e5", // indigo
	"#65a30d", // lime
	"#0d9488", // teal
] as const;

const SHAPES: FaceShape[] = ["circle", "hexagon", "squircle", "triangle", "drop", "cloud"];

/** FNV-1a, hex-wrapped. Stable across processes — the same handle always
 *  lands on the same face. */
export function faceSeed(handle: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < handle.length; i++) {
		hash ^= handle.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

/** Deterministic palette color for a handle (0-10% of the palette). */
export function faceColorFor(handle: string): string {
	return FACE_PALETTE[faceSeed(handle) % FACE_PALETTE.length];
}

/** Deterministic shape for a handle. */
export function faceShapeFor(handle: string): FaceShape {
	return SHAPES[faceSeed(`${handle}:shape`) % SHAPES.length];
}

/** The effective face for a coworker record: explicit fields win, otherwise
 *  derive from the handle. */
export function resolveFace(
	face: Face | undefined,
	handle: string,
): { color: string; shape: FaceShape; image?: string } {
	return {
		color: face?.color ?? faceColorFor(handle),
		shape: face?.shape ?? faceShapeFor(handle),
		image: face?.image,
	};
}

/** Lighten/darken a hex color by amount (-1..1); used for face gradients. */
export function shadeHex(hex: string, amount: number): string {
	const normalized = hex.replace("#", "");
	if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return hex;
	const num = Number.parseInt(normalized, 16);
	const channel = (value: number): number => {
		const next = amount >= 0 ? value + (255 - value) * amount : value * (1 + amount);
		return Math.max(0, Math.min(255, Math.round(next)));
	};
	const r = channel((num >> 16) & 0xff);
	const g = channel((num >> 8) & 0xff);
	const b = channel(num & 0xff);
	return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/** True when the hex color is dark enough to need light text on top. */
export function isDarkColor(hex: string): boolean {
	const normalized = hex.replace("#", "");
	if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return false;
	const num = Number.parseInt(normalized, 16);
	const r = (num >> 16) & 0xff;
	const g = (num >> 8) & 0xff;
	const b = num & 0xff;
	// Rec. 709 luma.
	return 0.2126 * r + 0.7152 * g + 0.0722 * b < 140;
}
