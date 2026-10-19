/**
 * Virtual office store — derives the animated floor state from a feed.
 *
 * Every feed update recomputes per-coworker status, speech bubbles, seat
 * targets, and collaboration links; a single requestAnimationFrame loop per
 * store eases avatars along L-shaped walk paths. Motion is written in one
 * batch per frame, so a room full of walkers still costs one React update.
 *
 * All animator state lives inside `createFloorStore`: two floors (2D and 3D,
 * or a preview and a full view) never share movers, spawn timestamps, or a
 * rAF handle. Renderers that read positions outside React (the 3D scene) can
 * subscribe to `visualVersion` instead of the whole state, so walk ticks do
 * not re-render furniture.
 */

import { createStore, type StoreApi } from "zustand/vanilla";
import { useStore } from "zustand";
import {
	type Point,
	deskSlot,
	faceColorFor,
	meetingSeat,
	pathPosition,
	walkDuration,
	walkPath,
} from "./geometry.ts";
import type { FaceShape, OfficeActivityItem, VirtualOfficeFeed } from "./types.ts";

export type FloorStatus = "idle" | "thinking" | "tool_calling" | "error";

export interface SpeechBubble {
	text: string;
	/** Epoch ms after which the bubble fades. */
	until: number;
}

export interface CoworkerVisual {
	id: string;
	name: string;
	handle: string;
	title?: string;
	image?: string;
	shape: FaceShape;
	color: string;
	status: FloorStatus;
	currentTool: string | null;
	bubble: SpeechBubble | null;
	pos: Point;
	deskIndex: number;
	inMeeting: boolean;
	/** Walk progress 0..1 while moving, null when seated. */
	walkT: number | null;
	/** Epoch ms until which the spawn ring shows (first appearance). */
	spawnUntil: number;
}

export interface CollaborationLink {
	/** Coworker ids, unordered. */
	a: string;
	b: string;
	/** Log timestamp of the newer message; alpha derives from age. */
	born: number;
}

export interface FloorState {
	coworkers: CoworkerVisual[];
	links: CollaborationLink[];
	/** Bumped on feed changes only (never on motion ticks). Renderers that
	 *  read positions in their own animation loop can use this as a cheap
	 *  "visuals changed" signal. */
	visualVersion: number;
	applyFeed: (feed: VirtualOfficeFeed) => void;
}

export type FloorStore = StoreApi<FloorState> & { dispose: () => void };

const LINK_TIMEOUT_MS = 60_000;
const SPEECH_MS = 12_000;
const ERROR_MS = 20_000;
/** After this much silence, a retained status (whose events fell out of the
 *  host's ring buffer) stops claiming the coworker is still working. */
const STATUS_STALE_MS = 5 * 60_000;

/** New coworkers spawn in the corridor and walk to their desk. */
const CORRIDOR_SPAWN: Point = { x: 12, y: 88 };

/** Browser animation-frame globals, read lazily off `globalThis` so tests can
 *  stub them and Node-only programs still typecheck. */
function requestFrame(callback: (time: number) => void): number | null {
	const fn = (globalThis as unknown as { requestAnimationFrame?: (cb: (time: number) => void) => number })
		.requestAnimationFrame;
	return fn ? fn(callback) : null;
}

function cancelFrame(handle: number): void {
	const fn = (globalThis as unknown as { cancelAnimationFrame?: (handle: number) => void })
		.cancelAnimationFrame;
	fn?.(handle);
}

export type DerivedActivity = {
	status: FloorStatus;
	currentTool: string | null;
	bubble: SpeechBubble | null;
	/** Timestamp of the newest event folded into this state. */
	at: number;
};

/** Derive per-coworker visual state from the feed's activity timeline.
 *  Timestamps are absolute: an old speech or error must not be resurrected
 *  just because a feed arrived later (the caller re-applies the whole
 *  activity buffer on every update). */
export function deriveActivity(activity: OfficeActivityItem[], now: number): Map<string, DerivedActivity> {
	const derived = new Map<string, DerivedActivity>();
	for (const event of activity) {
		const entry = derived.get(event.coworkerId) ?? {
			status: "idle" as FloorStatus,
			currentTool: null,
			bubble: null,
			at: 0,
		};
		entry.at = event.at;
		switch (event.kind) {
			case "turn_start":
				entry.status = "thinking";
				break;
			case "turn_end":
				entry.status = "idle";
				entry.currentTool = null;
				break;
			case "tool_start":
				entry.status = "tool_calling";
				entry.currentTool = event.toolName ?? "tool";
				break;
			case "tool_end":
				if (entry.status === "tool_calling") {
					entry.status = "thinking";
					entry.currentTool = null;
				}
				break;
			case "speaking":
				if (event.text && now - event.at < SPEECH_MS) {
					entry.bubble = { text: event.text, until: event.at + SPEECH_MS };
				}
				break;
			case "error":
				entry.status = "idle";
				entry.currentTool = null;
				if (now - event.at < ERROR_MS) {
					entry.bubble = { text: "Hit an error — recovering", until: event.at + ERROR_MS };
				}
				break;
		}
		derived.set(event.coworkerId, entry);
	}
	return derived;
}

/** Collaboration links from the room log: consecutive coworker messages
 *  inside the timeout window form an edge; the newest per pair wins. Only
 *  the recent tail matters — links expire after 60s. */
export function deriveLinks(feed: VirtualOfficeFeed, now = Date.now()): CollaborationLink[] {
	const links = new Map<string, CollaborationLink>();
	let last: { id: string; at: number } | null = null;
	// A link can only form inside the timeout window, so scanning the whole
	// log is wasted work on long-running rooms.
	const recent = feed.roomLog.slice(-200);
	for (const message of recent) {
		if (message.kind !== "coworker" || !message.coworkerId) continue;
		if (last && last.id !== message.coworkerId && message.at - last.at <= LINK_TIMEOUT_MS) {
			const key = [last.id, message.coworkerId].sort().join("\u0000");
			links.set(key, { a: last.id, b: message.coworkerId, born: message.at });
		}
		last = { id: message.coworkerId, at: message.at };
	}
	return [...links.values()].filter((link) => now - link.born <= LINK_TIMEOUT_MS);
}

export function createFloorStore(): FloorStore {
	const store = createStore<FloorState>()(() => ({
		coworkers: [],
		links: [],
		visualVersion: 0,
		applyFeed: () => {},
	}));

	/** In-flight walks, keyed by coworker id. */
	const movers = new Map<string, { path: Point[]; start: number; duration: number }>();
	/** Last planned destination per coworker, so in-flight walks survive feed ticks. */
	const plannedTargets = new Map<string, string>();
	/** First-seen timestamps, for the spawn ring. */
	const spawnedAt = new Map<string, number>();
	/** Last derived state per coworker, so a truncated activity buffer cannot
	 *  regress a still-running coworker to idle. */
	const lastActivity = new Map<string, DerivedActivity>();
	let rafHandle: number | null = null;
	let disposed = false;

	const planMove = (id: string, from: Point, to: Point): void => {
		const path = walkPath(from, to);
		movers.set(id, { path, start: performance.now(), duration: walkDuration(path) });
	};

	const tick = (now: number): void => {
		rafHandle = null;
		if (disposed) return;
		const updates = new Map<string, { pos: Point; walkT: number | null }>();
		for (const [id, mover] of movers) {
			const t = Math.min(1, (now - mover.start) / mover.duration);
			updates.set(id, { pos: pathPosition(mover.path, t), walkT: t >= 1 ? null : t });
			if (t >= 1) movers.delete(id);
		}
		// One state write for every walker on this frame — not one per mover.
		if (updates.size > 0) {
			store.setState((state) => ({
				coworkers: state.coworkers.map((coworker) => {
					const update = updates.get(coworker.id);
					return update ? { ...coworker, pos: update.pos, walkT: update.walkT } : coworker;
				}),
			}));
		}
		if (movers.size > 0) {
			rafHandle = requestFrame(tick);
		}
	};

	const startAnimator = (): void => {
		if (disposed || rafHandle !== null) return;
		rafHandle = requestFrame(tick);
	};

	const applyFeed = (feed: VirtualOfficeFeed): void => {
		const now = Date.now();
		const derived = deriveActivity(feed.activity, now);
		const seated = new Set(feed.roomRunning ? feed.roomMembers : []);
		const links = deriveLinks(feed, now);
		const seatIndex = new Map<string, number>();
		let cursor = 0;
		for (const id of feed.roomMembers) {
			if (seated.has(id)) {
				seatIndex.set(id, cursor);
				cursor += 1;
			}
		}

		// Retain the last known activity for coworkers whose earliest events
		// have been evicted from the host's ring buffer.
		for (const [id, activity] of derived) {
			lastActivity.set(id, activity);
		}

		store.setState((state) => {
			const previous = new Map(state.coworkers.map((c) => [c.id, c]));
			const present = new Set(feed.coworkers.map((c) => c.id));
			const coworkers = feed.coworkers.map((coworker, index) => {
				const shape = coworker.face.shape;
				const prior = previous.get(coworker.id);
				const activity = derived.get(coworker.id) ??
					lastActivity.get(coworker.id) ?? {
						status: "idle" as FloorStatus,
						currentTool: null,
						bubble: null,
						at: 0,
					};
				const settled = now - activity.at > STATUS_STALE_MS
					? { ...activity, status: "idle" as FloorStatus, currentTool: null, bubble: null }
					: activity;
				const deskIndex = prior?.deskIndex ?? index;
				const seat = seatIndex.get(coworker.id);
				const inMeeting = seat !== undefined;
				const target = inMeeting ? meetingSeat(Math.floor((seat ?? 0) / 3), (seat ?? 0) % 3) : deskSlot(deskIndex);

				// Plan a walk only when the target changed: replanning an
				// in-flight walk from its interpolated position on every feed
				// tick resets progress and the avatar just creeps.
				const targetKey = `${target.x.toFixed(2)},${target.y.toFixed(2)}`;
				if (prior) {
					const arrived = prior.pos.x === target.x && prior.pos.y === target.y;
					if (!arrived && plannedTargets.get(coworker.id) !== targetKey) {
						planMove(coworker.id, prior.pos, target);
					}
				} else {
					// First sight: spawn at the entrance and walk in.
					spawnedAt.set(coworker.id, now);
					planMove(coworker.id, CORRIDOR_SPAWN, target);
				}
				plannedTargets.set(coworker.id, targetKey);

				return {
					id: coworker.id,
					name: coworker.name,
					handle: coworker.handle,
					title: coworker.title,
					image: coworker.face.image,
					shape,
					color: coworker.face.color ?? faceColorFor(coworker.handle),
					status: settled.status,
					currentTool: settled.currentTool,
					bubble: settled.bubble && settled.bubble.until > now ? settled.bubble : null,
					pos: prior?.pos ?? CORRIDOR_SPAWN,
					deskIndex,
					inMeeting,
					walkT: prior?.walkT ?? null,
					spawnUntil: prior?.spawnUntil ?? spawnedAt.get(coworker.id) ?? 0,
				} satisfies CoworkerVisual;
			});

			// Drop bookkeeping for coworkers who left the roster, so a later
			// re-add starts from a clean slate.
			for (const id of plannedTargets.keys()) {
				if (!present.has(id)) plannedTargets.delete(id);
			}
			for (const id of spawnedAt.keys()) {
				if (!present.has(id)) spawnedAt.delete(id);
			}
			for (const id of lastActivity.keys()) {
				if (!present.has(id)) lastActivity.delete(id);
			}

			return { coworkers, links, visualVersion: state.visualVersion + 1 };
		});
		startAnimator();
	};

	store.setState({ applyFeed });

	return Object.assign(store, {
		dispose: () => {
			disposed = true;
			if (rafHandle !== null) {
				cancelFrame(rafHandle);
			}
			rafHandle = null;
			movers.clear();
			plannedTargets.clear();
			spawnedAt.clear();
			lastActivity.clear();
		},
	});
}

/** React hook: subscribe to the whole floor (2D scenes that render motion). */
export function useFloor(store: FloorStore): FloorState {
	return useStore(store);
}

/** React hook: subscribe to a slice (3D scenes that read motion outside React). */
export function useFloorSelector<T>(store: FloorStore, selector: (state: FloorState) => T): T {
	return useStore(store, selector);
}
