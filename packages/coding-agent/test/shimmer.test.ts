import { describe, expect, it } from "vitest";

/**
 * Tests for the shimmer effect in WorkingStatusIndicator.
 *
 * The shimmer is a 3-char window that sweeps right-to-left across the verb text,
 * resting 10 ticks off-screen on each side. The window clamps at text edges,
 * so it may be narrower when entering/exiting.
 */

const SHIMMER_HALF_WIDTH = 1; // 3-char window
const REST_PADDING = 10;

function applyShimmerForTest(text: string, tick: number): { before: number; shimmer: number; after: number } {
	const len = text.length;
	if (len === 0) return { before: 0, shimmer: 0, after: 0 };

	const cycleLength = len + REST_PADDING * 2;
	const glimmerIndex = len + REST_PADDING - (tick % cycleLength);
	const start = glimmerIndex - SHIMMER_HALF_WIDTH;
	const endExcl = glimmerIndex + SHIMMER_HALF_WIDTH + 1;

	if (start >= len || endExcl <= 0) return { before: len, shimmer: 0, after: 0 };

	const s = Math.max(0, start);
	const e = Math.min(len, endExcl);
	return { before: s, shimmer: e - s, after: len - e };
}

describe("shimmer effect", () => {
	it("shimmer rests off-screen at tick 0", () => {
		const text = "Hello world!";
		const result = applyShimmerForTest(text, 0);
		expect(result.shimmer).toBe(0);
		expect(result.before).toBe(text.length);
	});

	it("shimmer enters from right edge gradually", () => {
		const text = "Hello world!"; // 12 chars

		// At REST_PADDING ticks, shimmer covers just the last char
		const atEntry = applyShimmerForTest(text, REST_PADDING);
		expect(atEntry.shimmer).toBe(1);

		// Next tick: shimmer = 2 chars
		const next = applyShimmerForTest(text, REST_PADDING + 1);
		expect(next.shimmer).toBe(2);

		// Full 3-char window once past the edge
		const full = applyShimmerForTest(text, REST_PADDING + 2);
		expect(full.shimmer).toBe(3);
	});

	it("shimmer sweeps left across the text", () => {
		const text = "Hello"; // 5 chars

		// Full 3-char window in the middle of the text.
		const mid = applyShimmerForTest(text, REST_PADDING + 3);
		expect(mid.shimmer).toBe(3);
		expect(mid.before).toBe(1); // 1 char before the window
		expect(mid.after).toBe(1); // 1 char after

		// Sweeping further left.
		const further = applyShimmerForTest(text, REST_PADDING + 4);
		expect(further.before).toBe(0); // at left edge
	});

	it("shimmer exits left side gradually", () => {
		const text = "Hello"; // 5 chars

		// Near the end of the sweep.
		const exiting = applyShimmerForTest(text, REST_PADDING + 5 + 1);
		expect(exiting.shimmer).toBeLessThanOrEqual(3);

		// Fully off-screen after REST_PADDING ticks past the left edge.
		const offScreen = applyShimmerForTest(text, REST_PADDING + 5 + REST_PADDING + 1);
		expect(offScreen.shimmer).toBe(0);
	});

	it("cycle repeats after full sweep", () => {
		const text = "Test";
		const cycleLength = text.length + REST_PADDING * 2;

		const tick1 = applyShimmerForTest(text, 0);
		const tick2 = applyShimmerForTest(text, cycleLength);

		expect(tick1).toEqual(tick2);
	});

	it("short text shows partial shimmer window", () => {
		const text = "Hi"; // 2 chars

		// At entry, shimmer covers just the last char
		const atEntry = applyShimmerForTest(text, REST_PADDING);
		expect(atEntry.shimmer).toBe(1);

		// Full coverage as window moves left.
		const full = applyShimmerForTest(text, REST_PADDING + 1);
		expect(full.shimmer).toBe(2); // Both characters
	});
});
