import { describe, expect, it } from "vitest";
import { readRecentCommands, recordRecentCommand } from "./command-recents";

function memoryStorage(initial: string | null = null) {
	let value = initial;
	return {
		getItem: () => value,
		setItem: (_key: string, next: string) => {
			value = next;
		},
	};
}

describe("recent commands", () => {
	it("dedupes and moves the latest command first", () => {
		const storage = memoryStorage();
		recordRecentCommand("a", storage);
		recordRecentCommand("b", storage);
		recordRecentCommand("a", storage);
		expect(readRecentCommands(storage)).toEqual(["a", "b"]);
	});

	it("caps the list at five", () => {
		const storage = memoryStorage();
		for (let i = 0; i < 8; i++) recordRecentCommand(String(i), storage);
		expect(readRecentCommands(storage)).toEqual(["7", "6", "5", "4", "3"]);
	});

	it("survives malformed storage", () => {
		expect(readRecentCommands(memoryStorage("{"))).toEqual([]);
	});
});
