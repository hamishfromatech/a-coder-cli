import { describe, expect, it } from "vitest";
import { isHuddleUnread, useOfficeReadStore } from "./office-read-store";

describe("office read pointers", () => {
	it("treats activity newer than the read pointer as unread", () => {
		expect(isHuddleUnread(200, { room: 100 }, 0, "room")).toBe(true);
		expect(isHuddleUnread(90, { room: 100 }, 0, "room")).toBe(false);
		expect(isHuddleUnread(undefined, { room: 100 }, 0, "room")).toBe(false);
	});

	it("uses the install baseline for rooms never opened", () => {
		expect(isHuddleUnread(200, {}, 300, "room")).toBe(false);
		expect(isHuddleUnread(400, {}, 300, "room")).toBe(true);
	});

	it("tracks unread counts and mention flags, then clears them on read", () => {
		const id = `test-unread-${Date.now()}`;
		useOfficeReadStore.getState().recordActivity(id, 2, false);
		useOfficeReadStore.getState().recordActivity(id, 1, true);
		expect(useOfficeReadStore.getState().unread[id]).toBe(3);
		expect(useOfficeReadStore.getState().mentions[id]).toBe(true);
		useOfficeReadStore.getState().markRead(id, 600);
		expect(useOfficeReadStore.getState().unread[id]).toBeUndefined();
		expect(useOfficeReadStore.getState().mentions[id]).toBeUndefined();
	});

	it("persists read pointers and never moves them backwards", () => {
		const id = `test-room-${Date.now()}`;
		useOfficeReadStore.getState().markRead(id, 500);
		useOfficeReadStore.getState().markRead(id, 200);
		expect(useOfficeReadStore.getState().readAt[id]).toBe(500);
		const raw = localStorage.getItem("a-coder.office.readAt");
		expect(raw).toBeTruthy();
		const parsed = JSON.parse(raw ?? "{}") as { readAt: Record<string, number> };
		expect(parsed.readAt[id]).toBe(500);
	});
});
