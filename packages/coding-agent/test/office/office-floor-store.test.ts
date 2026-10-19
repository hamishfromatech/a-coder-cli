/**
 * Floor store regressions: bubble expiry, batched motion, per-store isolation,
 * and desk overflow. These cover the bugs that made the old floor resurrect
 * old speech and re-render once per walker per frame.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { DESK_SLOTS, deskSlot, HOT_DESK_SLOTS } from "../../../../virtual-office-ui/src/geometry.ts";
import {
	createFloorStore,
	deriveActivity,
	deriveLinks,
	type FloorState,
} from "../../../../virtual-office-ui/src/store.ts";
import type { VirtualOfficeFeed } from "../../../../virtual-office-ui/src/types.ts";

const rafQueue: Array<(time: number) => void> = [];

function feed(
	ids: string[],
	activity: VirtualOfficeFeed["activity"] = [],
	roomLog: VirtualOfficeFeed["roomLog"] = [],
): VirtualOfficeFeed {
	return {
		coworkers: ids.map((id) => ({
			id,
			name: id.toUpperCase(),
			handle: id,
			face: { shape: "circle" as const },
		})),
		activity,
		roomLog,
		roomRunning: false,
		roomMembers: [],
	};
}

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	rafQueue.length = 0;
});

describe("deriveActivity", () => {
	it("expires speech and errors by event time, not feed time", () => {
		const now = 1_000_000;
		const stale = deriveActivity(
			[
				{ coworkerId: "a", kind: "speaking", text: "old news", at: now - 20_000 },
				{ coworkerId: "b", kind: "error", at: now - 30_000 },
			],
			now,
		);
		expect(stale.get("a")?.bubble).toBeNull();
		expect(stale.get("b")?.bubble).toBeNull();
	});

	it("keeps a fresh bubble with an absolute expiry", () => {
		const now = 1_000_000;
		const derived = deriveActivity([{ coworkerId: "a", kind: "speaking", text: "fresh", at: now - 1_000 }], now);
		expect(derived.get("a")?.bubble).toEqual({ text: "fresh", until: now - 1_000 + 12_000 });
	});
});

describe("createFloorStore", () => {
	it("writes every walker's position in one state update per frame", () => {
		vi.spyOn(performance, "now").mockReturnValue(0);
		vi.stubGlobal("requestAnimationFrame", (callback: (time: number) => void) => {
			rafQueue.push(callback);
			return rafQueue.length;
		});
		vi.stubGlobal("cancelAnimationFrame", () => {});

		const store = createFloorStore();
		store.getState().applyFeed(feed(["a", "b", "c"]));

		const states: FloorState[] = [];
		const unsubscribe = store.subscribe((state) => states.push(state));
		const frame = rafQueue[rafQueue.length - 1];
		expect(frame).toBeTypeOf("function");
		frame?.(120);
		unsubscribe();

		expect(states).toHaveLength(1);
		expect(states[0]?.coworkers.map((c) => c.pos)).toEqual(store.getState().coworkers.map((c) => c.pos));
		expect(store.getState().coworkers.every((c) => c.pos.x > 12 || c.pos.y !== 88)).toBe(true);
		store.dispose();
	});

	it("keeps animators isolated per store", () => {
		let clock = 0;
		vi.spyOn(performance, "now").mockImplementation(() => clock);
		vi.stubGlobal("requestAnimationFrame", (callback: (time: number) => void) => {
			rafQueue.push(callback);
			return rafQueue.length;
		});
		vi.stubGlobal("cancelAnimationFrame", () => {});

		const first = createFloorStore();
		first.getState().applyFeed(feed(["a"]));
		const firstFrame = rafQueue[rafQueue.length - 1];

		clock = 1_000;
		const second = createFloorStore();
		second.getState().applyFeed(feed(["b"]));
		const secondFrame = rafQueue[rafQueue.length - 1];

		expect(firstFrame).not.toBe(secondFrame);
		const firstStart = first.getState().coworkers[0]?.pos;
		const secondStart = second.getState().coworkers[0]?.pos;

		firstFrame?.(2_000);
		expect(first.getState().coworkers[0]?.pos).not.toEqual(firstStart);
		expect(second.getState().coworkers[0]?.pos).toEqual(secondStart);

		first.dispose();
		second.dispose();
	});

	it("bumps visualVersion on feeds but not on motion ticks", () => {
		vi.spyOn(performance, "now").mockReturnValue(0);
		vi.stubGlobal("requestAnimationFrame", (callback: (time: number) => void) => {
			rafQueue.push(callback);
			return rafQueue.length;
		});
		vi.stubGlobal("cancelAnimationFrame", () => {});

		const store = createFloorStore();
		store.getState().applyFeed(feed(["a"]));
		const version = store.getState().visualVersion;
		rafQueue[rafQueue.length - 1]?.(100);
		expect(store.getState().visualVersion).toBe(version);
		store.getState().applyFeed(feed(["a"]));
		expect(store.getState().visualVersion).toBeGreaterThan(version);
		store.dispose();
	});
});

describe("deriveLinks", () => {
	it("links consecutive coworker messages inside the window", () => {
		const now = 1_000_000;
		const links = deriveLinks(
			feed(
				["a", "b"],
				[],
				[
					{ id: "1", at: now - 5_000, kind: "coworker", coworkerId: "a", text: "hi" },
					{ id: "2", at: now - 4_000, kind: "coworker", coworkerId: "b", text: "hey" },
				],
			),
			now,
		);
		expect(links).toEqual([{ a: "a", b: "b", born: now - 4_000 }]);
	});

	it("drops links older than the timeout", () => {
		const now = 1_000_000;
		const links = deriveLinks(
			feed(
				["a", "b"],
				[],
				[
					{ id: "1", at: now - 120_000, kind: "coworker", coworkerId: "a", text: "hi" },
					{ id: "2", at: now - 119_000, kind: "coworker", coworkerId: "b", text: "hey" },
				],
			),
			now,
		);
		expect(links).toEqual([]);
	});
});

describe("deskSlot overflow", () => {
	it("gives every roster member a distinct spot beyond the six desks", () => {
		const spots = Array.from({ length: DESK_SLOTS.length + HOT_DESK_SLOTS.length }, (_, i) => deskSlot(i));
		const keys = new Set(spots.map((p) => `${p.x},${p.y}`));
		expect(keys.size).toBe(spots.length);
		expect(deskSlot(DESK_SLOTS.length)).toEqual(HOT_DESK_SLOTS[0]);
	});
});
