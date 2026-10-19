import { beforeEach, describe, expect, it } from "vitest";
import type { OfficeHuddlePayload, OfficeMessage } from "../lib/rpc";
import { useOfficeStore } from "./office-store";

function message(id: string, at: number): OfficeMessage {
	return { id, at, from: { kind: "coworker", id: "a1", name: "Atlas" }, text: id };
}

function payload(huddleId: string, log: OfficeMessage[]): OfficeHuddlePayload {
	return {
		huddleId,
		working: { a1: true },
		data: { epoch: 1, log, watermarks: {}, holds: {} },
	};
}

beforeEach(() => {
	useOfficeStore.setState({ huddles: {}, snapshot: null, activity: [] });
});

describe("office huddle deltas", () => {
	it("appends new messages once and updates the live drive state", () => {
		useOfficeStore.getState().applyHuddle(payload("h1", [message("m1", 1)]));
		useOfficeStore.getState().applyHuddleDelta({
			huddleId: "h1",
			epoch: 2,
			messages: [message("m1", 1), message("m2", 2)],
			running: { startedAt: 2, current: "Nova", thread: 2 },
			working: { a1: false, n1: true },
		});

		const room = useOfficeStore.getState().huddles.h1;
		expect(room?.data.log.map((m) => m.id)).toEqual(["m1", "m2"]);
		expect(room?.data.epoch).toBe(2);
		expect(room?.data.running?.current).toBe("Nova");
		expect(room?.working).toEqual({ a1: false, n1: true });
	});

	it("clears running when the drive settles", () => {
		useOfficeStore.getState().applyHuddle({
			...payload("h1", [message("m1", 1)]),
			data: { epoch: 1, log: [message("m1", 1)], watermarks: {}, holds: {}, running: { startedAt: 1, thread: 1 } },
		});
		useOfficeStore.getState().applyHuddleDelta({
			huddleId: "h1",
			epoch: 1,
			messages: [],
			working: { a1: false },
		});
		expect(useOfficeStore.getState().huddles.h1?.data.running).toBeUndefined();
	});

	it("ignores a delta for a room that has never been loaded", () => {
		useOfficeStore.getState().applyHuddleDelta({
			huddleId: "cold",
			epoch: 1,
			messages: [message("m1", 1)],
			working: {},
		});
		expect(useOfficeStore.getState().huddles.cold).toBeUndefined();
	});
});
