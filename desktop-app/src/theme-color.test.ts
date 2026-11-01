import { describe, expect, it } from "vitest";
import { readableOn } from "./lib/theme-color";

describe("readableOn", () => {
	it("chooses the higher-contrast label", () => {
		// Bright accents take a dark label; deep accents take a light one.
		expect(readableOn("#ffd400")).toBe("#161616");
		expect(readableOn("#e8875a")).toBe("#161616");
		expect(readableOn("#4cc9dd")).toBe("#161616");
		expect(readableOn("#0e7490")).toBe("#ffffff");
		expect(readableOn("#1a1b22")).toBe("#ffffff");
	});
});
