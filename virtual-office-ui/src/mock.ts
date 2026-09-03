/**
 * Mock feed for standalone development — a believable office day: huddle
 * kickoff, tool work, handoffs, speech, an error, and a settle. Same shapes
 * the desktop app feeds from office RPC events.
 */

import type { OfficeActivityItem, OfficeRoomMessage, VirtualOfficeFeed } from "./types.ts";

const C = [
	{ id: "atlas", name: "Atlas", handle: "atlas", title: "Scout", face: { shape: "hexagon" as const, color: "#2563eb" } },
	{ id: "nova", name: "Nova", handle: "nova", title: "Builder", face: { shape: "squircle" as const, color: "#7c3aed" } },
	{ id: "pixel", name: "Pixel", handle: "pixel", title: "Reviewer", face: { shape: "circle" as const, color: "#0891b2" } },
	{ id: "echo", name: "Echo", handle: "echo", title: "Ops", face: { shape: "drop" as const, color: "#d97706" } },
];

const SCRIPT: Array<{ at: number; kind: OfficeActivityItem["kind"]; coworkerId: string; toolName?: string; text?: string }> = [
	{ at: 0, kind: "turn_start", coworkerId: "atlas" },
	{ at: 1, kind: "tool_start", coworkerId: "atlas", toolName: "read" },
	{ at: 2, kind: "tool_end", coworkerId: "atlas", toolName: "read" },
	{ at: 2.5, kind: "tool_start", coworkerId: "atlas", toolName: "grep" },
	{ at: 3.5, kind: "tool_end", coworkerId: "atlas", toolName: "grep" },
	{ at: 4, kind: "speaking", coworkerId: "atlas", text: "Found it — the office store rewrites the whole file on every save, so two rapid writes race. Handing the fix to @nova." },
	{ at: 4.2, kind: "turn_end", coworkerId: "atlas" },
	{ at: 4.6, kind: "turn_start", coworkerId: "nova" },
	{ at: 5.2, kind: "tool_start", coworkerId: "nova", toolName: "edit" },
	{ at: 7.5, kind: "tool_end", coworkerId: "nova", toolName: "edit" },
	{ at: 8, kind: "speaking", coworkerId: "nova", text: "Serialized the writes through the keyed mutex. @pixel can you run the office tests to confirm?" },
	{ at: 8.2, kind: "turn_end", coworkerId: "nova" },
	{ at: 8.8, kind: "turn_start", coworkerId: "pixel" },
	{ at: 9.5, kind: "tool_start", coworkerId: "pixel", toolName: "bash" },
	{ at: 12, kind: "tool_end", coworkerId: "pixel", toolName: "bash" },
	{ at: 12.4, kind: "speaking", coworkerId: "pixel", text: "All 44 office tests pass. Store, rounds, and soul all green." },
	{ at: 12.6, kind: "turn_end", coworkerId: "pixel" },
	{ at: 14, kind: "turn_start", coworkerId: "echo" },
	{ at: 15, kind: "error", coworkerId: "echo" },
	{ at: 16.5, kind: "turn_start", coworkerId: "echo" },
	{ at: 18, kind: "speaking", coworkerId: "echo", text: "Retried the deploy errand — succeeded on the second attempt." },
	{ at: 18.2, kind: "turn_end", coworkerId: "echo" },
];

const ROOM_SCRIPT: Array<{ at: number; kind: OfficeRoomMessage["kind"]; coworkerId?: string; text: string }> = [
	{ at: 0, kind: "user", text: "The office store is racing on rapid saves — team, dig in." },
	{ at: 4, kind: "coworker", coworkerId: "atlas", text: "Found it — the office store rewrites the whole file on every save, so two rapid writes race. Handing the fix to @nova." },
	{ at: 8, kind: "coworker", coworkerId: "nova", text: "Serialized the writes through the keyed mutex. @pixel can you run the office tests to confirm?" },
	{ at: 12.4, kind: "coworker", coworkerId: "pixel", text: "All 44 office tests pass. Store, rounds, and soul all green." },
];

/** Build a feed at scenario time `t` (seconds since kickoff). */
export function mockFeed(t: number): VirtualOfficeFeed {
	const now = Date.now();
	const activity: OfficeActivityItem[] = SCRIPT.filter((step) => step.at <= t).map((step) => ({
		...step,
		at: now - (t - step.at) * 1000,
	}));
	const roomLog: OfficeRoomMessage[] = ROOM_SCRIPT.filter((step) => step.at <= t).map((step) => ({
		id: `m${step.at}`,
		at: now - (t - step.at) * 1000,
		kind: step.kind,
		coworkerId: step.coworkerId,
		text: step.text,
	}));
	return {
		coworkers: C.map((c) => ({ ...c, face: { ...c.face, color: c.face.color } })),
		activity,
		roomLog,
		roomRunning: t > 0 && t < 20,
		roomMembers: C.map((c) => c.id),
		roomName: "store-race",
	};
}

/** Run the scenario on a loop; returns a cancel function. */
export function startMockLoop(onTick: (feed: VirtualOfficeFeed) => void, loopSeconds = 40): () => void {
	const started = Date.now();
	const timer = setInterval(() => {
		const t = ((Date.now() - started) / 1000) % loopSeconds;
		onTick(mockFeed(t));
	}, 400);
	return () => clearInterval(timer);
}