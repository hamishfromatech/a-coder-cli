/**
 * Virtual office store — derives the animated floor state from a feed.
 *
 * Every feed update recomputes per-coworker status, speech bubbles, seat
 * targets, and collaboration links; a single requestAnimationFrame loop eases
 * avatars along L-shaped walk paths. Pure React/zustand — no engine imports.
 */

import { createStore } from "zustand/vanilla";
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
	applyFeed: (feed: VirtualOfficeFeed) => void;
}

const LINK_TIMEOUT_MS = 60_000;
const SPEECH_MS = 12_000;
const ERROR_MS = 20_000;

/** In-flight walks, keyed by coworker id. */
const movers = new Map<string, { path: Point[]; start: number; duration: number }>();
/** Last planned destination per coworker, so in-flight walks survive feed ticks. */
const plannedTargets = new Map<string, string>();
/** First-seen timestamps, for the spawn ring. */
const spawnedAt = new Map<string, number>();
let rafHandle: number | null = null;
let storeRef: FloorStore | null = null;

export type FloorStore = ReturnType<typeof createFloorStore>;

function planMove(id: string, from: Point, to: Point): void {
	const path = walkPath(from, to);
	movers.set(id, { path, start: performance.now(), duration: walkDuration(path) });
}

function startAnimator(): void {
	if (rafHandle !== null) return;
	const tick = (now: number) => {
		const store = storeRef;
		if (!store) {
			rafHandle = null;
			return;
		}
		for (const [id, mover] of movers) {
			const t = Math.min(1, (now - mover.start) / mover.duration);
			const pos = pathPosition(mover.path, t);
			if (t >= 1) movers.delete(id);
			store.setState((state) => ({
				coworkers: state.coworkers.map((c) =>
					c.id === id ? { ...c, pos, walkT: t >= 1 ? null : t } : c,
				),
			}));
		}
		if (movers.size > 0) {
			rafHandle = requestAnimationFrame(tick);
		} else {
			rafHandle = null;
		}
	};
	rafHandle = requestAnimationFrame(tick);
}

/** Derive per-coworker visual state from the feed's activity timeline. */
function deriveActivity(
	activity: OfficeActivityItem[],
	now: number,
): Map<string, { status: FloorStatus; currentTool: string | null; bubble: SpeechBubble | null }> {
	const derived = new Map<
		string,
		{ status: FloorStatus; currentTool: string | null; bubble: SpeechBubble | null }
	>();
	for (const event of activity) {
		const entry = derived.get(event.coworkerId) ?? {
			status: "idle" as FloorStatus,
			currentTool: null,
			bubble: null,
		};
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
				if (event.text) {
					entry.bubble = { text: event.text, until: now + SPEECH_MS };
				}
				break;
			case "error":
				entry.status = "idle";
				entry.currentTool = null;
				if (now - event.at < ERROR_MS) {
					entry.bubble = { text: "Hit an error — recovering", until: now + ERROR_MS };
				}
				break;
		}
		derived.set(event.coworkerId, entry);
	}
	return derived;
}

/** Collaboration links from the room log: consecutive coworker messages
 *  inside the timeout window form an edge; the newest per pair wins. */
function deriveLinks(feed: VirtualOfficeFeed): CollaborationLink[] {
	const links = new Map<string, CollaborationLink>();
	let last: { id: string; at: number } | null = null;
	for (const message of feed.roomLog) {
		if (message.kind !== "coworker" || !message.coworkerId) continue;
		if (last && last.id !== message.coworkerId && message.at - last.at <= LINK_TIMEOUT_MS) {
			const key = [last.id, message.coworkerId].sort().join("\u0000");
			links.set(key, { a: last.id, b: message.coworkerId, born: message.at });
		}
		last = { id: message.coworkerId, at: message.at };
	}
	const now = Date.now();
	return [...links.values()].filter((link) => now - link.born <= LINK_TIMEOUT_MS);
}

export function createFloorStore() {
	const store = createStore<FloorState>()(() => ({
		coworkers: [],
		links: [],
		applyFeed: () => {},
	}));
	storeRef = store;

	const applyFeed = (feed: VirtualOfficeFeed): void => {
		const now = Date.now();
		const derived = deriveActivity(feed.activity, now);
		const seated = new Set(feed.roomRunning ? feed.roomMembers : []);
		const links = deriveLinks(feed);
		const seatIndex = new Map<string, number>();
		let cursor = 0;
		for (const id of feed.roomMembers) {
			if (seated.has(id)) {
				seatIndex.set(id, cursor);
				cursor += 1;
			}
		}

		store.setState((state) => {
			const previous = new Map(state.coworkers.map((c) => [c.id, c]));
			const coworkers = feed.coworkers.map((coworker, index) => {
				const shape = coworker.face.shape;
				const prior = previous.get(coworker.id);
				const activity = derived.get(coworker.id) ?? {
					status: "idle" as FloorStatus,
					currentTool: null,
					bubble: null,
				};
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
					status: activity.status,
					currentTool: activity.currentTool,
					bubble: activity.bubble && activity.bubble.until > now ? activity.bubble : null,
					pos: prior?.pos ?? CORRIDOR_SPAWN,
					deskIndex,
					inMeeting,
					walkT: prior?.walkT ?? null,
					spawnUntil: prior?.spawnUntil ?? spawnedAt.get(coworker.id) ?? 0,
				} satisfies CoworkerVisual;
			});
			return { coworkers, links };
		});
		startAnimator();
	};

	store.setState({ applyFeed });
	return store;
}

/** New coworkers spawn in the corridor and walk to their desk. */
const CORRIDOR_SPAWN: Point = { x: 12, y: 88 };

/** React hook: subscribe to the floor store. */
export function useFloor(store: FloorStore): FloorState {
	return useStore(store);
}