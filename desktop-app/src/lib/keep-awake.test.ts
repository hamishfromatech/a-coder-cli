import { describe, expect, it } from "vitest";
import {
	DEFAULT_KEEP_AWAKE_MODE,
	keepAwakeWanted,
	parseKeepAwakeMode,
} from "./keep-awake";

describe("keep-awake", () => {
	it("defaults to while-working", () => {
		expect(DEFAULT_KEEP_AWAKE_MODE).toBe("while-working");
	});

	it("parses only known modes", () => {
		expect(parseKeepAwakeMode("off")).toBe("off");
		expect(parseKeepAwakeMode("while-working")).toBe("while-working");
		expect(parseKeepAwakeMode("always")).toBe("always");
		expect(parseKeepAwakeMode(true)).toBeNull();
		expect(parseKeepAwakeMode("sometimes")).toBeNull();
		expect(parseKeepAwakeMode(null)).toBeNull();
	});

	it("holds the blocker only when the mode and work state call for it", () => {
		expect(keepAwakeWanted("off", true)).toBe(false);
		expect(keepAwakeWanted("while-working", false)).toBe(false);
		expect(keepAwakeWanted("while-working", true)).toBe(true);
		expect(keepAwakeWanted("always", false)).toBe(true);
		expect(keepAwakeWanted("always", true)).toBe(true);
	});
});
