import { describe, expect, it } from "vitest";
import type { OfficeCoworker, OfficeHuddlePayload, OfficeSnapshot } from "./rpc";
import { searchOffice, sortCoworkers, sortOfficeRooms } from "./office-search";

const coworker = (id: string, name: string): OfficeCoworker => ({
	id,
	name,
	handle: id,
	soul: "",
	face: { shape: "circle" },
	autonomy: "supervised",
	createdAt: 0,
	sessions: {},
});

const snapshot = {
	coworkers: [coworker("a1", "Atlas"), coworker("n1", "Nova")],
	statuses: {},
	huddles: [
		{ id: "dm:a1", name: "Atlas", members: ["a1"], lastActive: 10 },
		{ id: "h1", name: "Launch room", members: ["a1", "n1"], lastActive: 20 },
	],
	errands: [],
	pendingPrompts: [],
} as unknown as OfficeSnapshot;

const room = (id: string, text: string, at: number): OfficeHuddlePayload => ({
	huddleId: id,
	working: {},
	data: {
		epoch: 0,
		log: [{ id: `${id}-${at}`, at, from: { kind: "user", name: "User" }, text }],
		watermarks: {},
		holds: {},
	},
});

describe("office search", () => {
	it("sorts pinned rooms first, then by activity", () => {
		const rooms = [
			{ id: "a", lastActive: 1 },
			{ id: "b", lastActive: 3 },
			{ id: "c", lastActive: 2 },
		];
		expect(sortOfficeRooms(rooms, new Set(["a"])).map((r) => r.id)).toEqual(["a", "b", "c"]);
	});

	it("searches room names and recent messages", () => {
		const huddles = { h1: room("h1", "the deploy is blocked on CI", 30) };
		const hits = searchOffice(snapshot, huddles, "deploy");
		expect(hits).toHaveLength(1);
		expect(hits[0]).toMatchObject({ huddleId: "h1", title: "Launch room" });
		expect(hits[0]?.snippet).toContain("deploy");
		expect(searchOffice(snapshot, huddles, "launch")[0]).toMatchObject({ huddleId: "h1", snippet: "Room name" });
		expect(searchOffice(snapshot, huddles, "nothing")).toEqual([]);
	});

	it("sorts coworker DMs with pinned first", () => {
		const lastActive = (id: string) => ({ a1: 1, n1: 5 })[id];
		expect(sortCoworkers(snapshot.coworkers, lastActive, new Set(["dm:a1"])).map((c) => c.id)).toEqual([
			"a1",
			"n1",
		]);
	});
});
