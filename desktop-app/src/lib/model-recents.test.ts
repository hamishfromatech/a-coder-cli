import { describe, expect, it } from "vitest";
import { readRecentModels, recordRecentModel } from "./model-recents";

function memoryStorage(initial: string | null = null) {
	let value = initial;
	return {
		getItem: () => value,
		setItem: (_key: string, next: string) => {
			value = next;
		},
	};
}

describe("recent models", () => {
	it("defaults to empty", () => {
		expect(readRecentModels(memoryStorage())).toEqual([]);
	});

	it("dedupes and moves the newest first", () => {
		const storage = memoryStorage();
		recordRecentModel("anthropic", "sonnet", storage);
		recordRecentModel("openai", "gpt", storage);
		recordRecentModel("anthropic", "sonnet", storage);
		expect(readRecentModels(storage)).toEqual([
			{ provider: "anthropic", id: "sonnet" },
			{ provider: "openai", id: "gpt" },
		]);
	});

	it("caps the list at six and drops malformed entries", () => {
		const storage = memoryStorage(JSON.stringify([{ provider: "x", id: "1" }, null, { id: "nope" }]));
		for (let i = 0; i < 8; i++) recordRecentModel("p", String(i), storage);
		const recents = readRecentModels(storage);
		expect(recents).toHaveLength(6);
		expect(recents[0]).toEqual({ provider: "p", id: "7" });
	});

	it("survives malformed storage", () => {
		expect(readRecentModels(memoryStorage("{"))).toEqual([]);
	});
});
