import { describe, expect, test } from "vitest";
import { formatMessageTimestamp } from "../src/modes/interactive/components/message-time.ts";

describe("formatMessageTimestamp", () => {
	const now = new Date(2026, 2, 10, 15, 0, 0).getTime();

	test("shows only the time for today", () => {
		const result = formatMessageTimestamp(new Date(2026, 2, 10, 9, 5, 0).getTime(), now, "en-US");
		expect(result).toContain("9:05");
		expect(result).not.toContain("Mar");
	});

	test("labels yesterday and adds a date for older messages", () => {
		expect(formatMessageTimestamp(new Date(2026, 2, 9, 18, 30, 0).getTime(), now, "en-US")).toMatch(/^Yesterday\s/);
		expect(formatMessageTimestamp(new Date(2026, 2, 4, 14, 30, 0).getTime(), now, "en-US")).toMatch(/^Mar 4,\s/);
		expect(formatMessageTimestamp(new Date(2025, 2, 4, 14, 30, 0).getTime(), now, "en-US")).toMatch(
			/^Mar 4, 2025,\s/,
		);
	});

	test("returns an empty label for missing or invalid timestamps", () => {
		expect(formatMessageTimestamp(undefined, now)).toBe("");
		expect(formatMessageTimestamp(Number.NaN, now)).toBe("");
	});
});
