import { describe, expect, it } from "vitest";
import { DEFAULT_SESSION_LIST_PREFS, readSessionListPrefs, writeSessionListPrefs } from "./session-list-prefs";

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

describe("session list preferences", () => {
	it("defaults to compact rows with message counts", () => {
		expect(readSessionListPrefs(memoryStorage())).toEqual(DEFAULT_SESSION_LIST_PREFS);
	});

	it("round-trips density and metadata", () => {
		const storage = memoryStorage();
		writeSessionListPrefs({ density: "detailed", meta: ["tokens", "cost", "model"] }, storage);
		expect(readSessionListPrefs(storage)).toEqual({
			density: "detailed",
			meta: ["tokens", "cost", "model"],
		});
	});

	it("drops unknown values", () => {
		const storage = memoryStorage(JSON.stringify({ density: "huge", meta: ["tokens", "nope"] }));
		expect(readSessionListPrefs(storage)).toEqual({ density: "compact", meta: ["tokens"] });
	});

	it("survives malformed storage", () => {
		expect(readSessionListPrefs(memoryStorage("{"))).toEqual(DEFAULT_SESSION_LIST_PREFS);
	});
});
