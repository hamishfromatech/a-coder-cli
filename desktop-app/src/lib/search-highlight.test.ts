import { describe, expect, it } from "vitest";
import { highlightSegments } from "./search-highlight";

describe("highlightSegments", () => {
	it("marks every case-insensitive occurrence", () => {
		expect(highlightSegments("Foo foo", "foo", false)).toEqual([
			{ text: "Foo", hit: true },
			{ text: " ", hit: false },
			{ text: "foo", hit: true },
		]);
	});

	it("respects case sensitivity", () => {
		expect(highlightSegments("Foo foo", "foo", true)).toEqual([
			{ text: "Foo ", hit: false },
			{ text: "foo", hit: true },
		]);
	});

	it("returns the line untouched for an empty query", () => {
		expect(highlightSegments("plain", "  ", false)).toEqual([{ text: "plain", hit: false }]);
	});
});
