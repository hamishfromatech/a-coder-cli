/**
 * Virtual office geometry — zones, desk slots, meeting seats, and walk paths.
 *
 * The office lives in a 160x100 abstract coordinate space rendered through a
 * single SVG viewBox, so the same layout scales to any panel size. All
 * functions are pure; the store owns state.
 */

export interface Point {
	x: number;
	y: number;
}

/** Desk slots: two columns of three, left wall. Index = roster order. */
export const DESK_SLOTS: Point[] = [
	{ x: 26, y: 16 },
	{ x: 62, y: 16 },
	{ x: 26, y: 42 },
	{ x: 62, y: 42 },
	{ x: 26, y: 68 },
	{ x: 62, y: 68 },
];

/** Meeting tables (right side) with three seats each. */
export const MEETING_TABLES: Point[] = [
	{ x: 122, y: 18 },
	{ x: 122, y: 46 },
];

export const SEATS_PER_TABLE = 3;

/** Where a coworker sits around table `tableIndex`, seat `seat` (0..2). */
export function meetingSeat(tableIndex: number, seat: number): Point {
	const table = MEETING_TABLES[tableIndex] ?? MEETING_TABLES[0];
	if (!table) return { x: 122, y: 18 };
	const angle = (-90 + seat * 120) * (Math.PI / 180);
	return {
		x: table.x + Math.cos(angle) * 11.5,
		y: table.y + Math.sin(angle) * 11.5,
	};
}

/** Overflow standing spots along the corridor for roster members past the
 *  six desks. Keeping these distinct from DESK_SLOTS prevents a seventh
 *  coworker from standing exactly on top of the first. */
export const HOT_DESK_SLOTS: Point[] = [
	{ x: 24, y: 84 },
	{ x: 32, y: 84 },
	{ x: 40, y: 84 },
	{ x: 46, y: 84 },
	{ x: 118, y: 84 },
	{ x: 126, y: 84 },
	{ x: 134, y: 84 },
	{ x: 142, y: 84 },
	{ x: 150, y: 84 },
];

/** Corridor entrance — where unseated/new coworkers stand. */
export const CORRIDOR_ENTRANCE: Point = { x: 12, y: 88 };

/** Seat slot for a roster index. Desk seats come first; extra coworkers stand
 *  at a distinct hot-desk spot in the corridor. */
export function deskSlot(index: number): Point {
	const desk = DESK_SLOTS[index];
	if (desk) return desk;
	const hot = HOT_DESK_SLOTS[index - DESK_SLOTS.length];
	if (hot) return hot;
	return CORRIDOR_ENTRANCE;
}

/** Walk duration for a path in ms (bounded). */
export function walkDuration(path: Point[]): number {
	let length = 0;
	for (let i = 1; i < path.length; i++) {
		const a = path[i - 1];
		const b = path[i];
		if (a && b) length += Math.hypot(b.x - a.x, b.y - a.y);
	}
	return Math.min(2600, Math.max(500, length * 26));
}

/** L-shaped walking path (x first, then y) between two points. */
export function walkPath(from: Point, to: Point): Point[] {
	if (from.x === to.x && from.y === to.y) return [from, to];
	// Route through the corridor band (y=86) so walks never cut through desks.
	const corridorY = 86;
	if (to.y < corridorY && from.y < corridorY && Math.abs(from.x - to.x) > 4) {
		return [from, { x: from.x, y: corridorY }, { x: to.x, y: corridorY }, to];
	}
	return [from, { x: from.x, y: to.y }, to];
}

/** Position along a path at progress t (0..1), eased. */
export function pathPosition(path: Point[], t: number): Point {
	const segments = path.length - 1;
	if (segments < 1) return path[0] ?? { x: 0, y: 0 };
	if (t >= 1) return path[segments] ?? { x: 0, y: 0 };
	const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
	const scaled = Math.min(0.999, Math.max(0, eased)) * segments;
	const index = Math.floor(scaled);
	const local = scaled - index;
	const a = path[index];
	const b = path[index + 1];
	if (!a || !b) return a ?? { x: 0, y: 0 };
	return { x: a.x + (b.x - a.x) * local, y: a.y + (b.y - a.y) * local };
}

/** Face palette — same hues as the engine's procedural avatars. */
export const FACE_PALETTE = [
	"#2563eb",
	"#7c3aed",
	"#0891b2",
	"#059669",
	"#d97706",
	"#dc2626",
	"#db2777",
	"#4f46e5",
	"#65a30d",
	"#0d9488",
] as const;

/** FNV-1a — matches the engine's faceSeed so both sides agree on colors. */
export function faceSeed(handle: string): number {
	let hash = 0x811c9dc5;
	for (let i = 0; i < handle.length; i++) {
		hash ^= handle.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

export function faceColorFor(handle: string): string {
	return FACE_PALETTE[faceSeed(handle) % FACE_PALETTE.length] ?? FACE_PALETTE[0];
}