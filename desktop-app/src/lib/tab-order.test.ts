import { describe, expect, it } from "vitest";
import { moveBefore, moveTabBefore } from "./tab-order";

const tabs = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

describe("moveTabBefore", () => {
	it("moves a tab to the target slot", () => {
		expect(moveTabBefore(tabs, "a", "c").map((tab) => tab.id)).toEqual(["b", "a", "c", "d"]);
		expect(moveTabBefore(tabs, "d", "b").map((tab) => tab.id)).toEqual(["a", "d", "b", "c"]);
	});

	it("returns the same list when nothing would move", () => {
		expect(moveTabBefore(tabs, "b", "b")).toBe(tabs);
		expect(moveTabBefore(tabs, "missing", "b")).toBe(tabs);
		expect(moveTabBefore(tabs, "b", "missing")).toBe(tabs);
	});
});

describe("moveBefore", () => {
	it("reorders items by an arbitrary identity", () => {
		const sessions = [{ path: "/a" }, { path: "/b" }, { path: "/c" }];
		expect(moveBefore(sessions, (s) => s.path, "/c", "/a").map((s) => s.path)).toEqual([
			"/c",
			"/a",
			"/b",
		]);
	});
});
