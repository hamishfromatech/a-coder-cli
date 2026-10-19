import { describe, expect, it } from "vitest";
import { readHiddenStatusItems, writeHiddenStatusItems } from "./statusbar-prefs";

function memoryStorage(initial: string | null = null) {
	let value = initial;
	return {
		getItem: () => value,
		setItem: (_key: string, next: string) => {
			value = next;
		},
		read: () => value,
	};
}

describe("status bar preferences", () => {
	it("defaults to nothing hidden", () => {
		expect(readHiddenStatusItems(memoryStorage())).toEqual(new Set());
	});

	it("round-trips known items and drops unknown ones", () => {
		const storage = memoryStorage();
		writeHiddenStatusItems(new Set(["thinking", "stats"]), storage);
		expect(readHiddenStatusItems(storage)).toEqual(new Set(["thinking", "stats"]));

		const mixed = memoryStorage(JSON.stringify(["context", "nope"]));
		expect(readHiddenStatusItems(mixed)).toEqual(new Set(["context"]));
	});

	it("survives malformed storage", () => {
		expect(readHiddenStatusItems(memoryStorage("{"))).toEqual(new Set());
	});
});
