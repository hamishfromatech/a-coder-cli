import { describe, expect, it } from "vitest";
import { applySessionOrder, readSessionOrder, writeSessionOrder } from "./session-order";

function memoryStorage(initial: string | null = null) {
	let value = initial;
	return {
		getItem: () => value,
		setItem: (_key: string, next: string) => {
			value = next;
		},
	};
}

describe("session order", () => {
	it("round-trips paths", () => {
		const storage = memoryStorage();
		writeSessionOrder(["b", "a"], storage);
		expect(readSessionOrder(storage)).toEqual(["b", "a"]);
	});

	it("orders known paths and keeps unseen ones after them", () => {
		const sessions = [{ path: "a" }, { path: "b" }, { path: "c" }];
		expect(applySessionOrder(sessions, ["c", "a"]).map((entry) => entry.path)).toEqual(["c", "a", "b"]);
	});

	it("survives malformed storage", () => {
		expect(readSessionOrder(memoryStorage("{"))).toEqual([]);
	});
});
