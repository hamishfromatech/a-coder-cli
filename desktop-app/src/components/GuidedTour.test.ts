import { afterEach, describe, expect, it } from "vitest";

const { computeCardPosition } = await import("../components/GuidedTour");

const rect = (left: number, top: number, width: number, height: number) =>
	({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;

const win = (vw: number, vh: number) => {
	Object.defineProperty(window, "innerWidth", { value: vw, configurable: true });
	Object.defineProperty(window, "innerHeight", { value: vh, configurable: true });
};

describe("computeCardPosition", () => {
	afterEach(() => win(1440, 900));

	it("holds the no-target card centered inside the viewport", () => {
		win(900, 600);
		const { left, top } = computeCardPosition(null, 400, 240);
		expect(left).toBeGreaterThanOrEqual(12);
		expect(top).toBeGreaterThanOrEqual(12);
		expect(left + 400).toBeLessThanOrEqual(888);
	});

	it("places the card to the RIGHT of a full-height left rail", () => {
		const spot = rect(0, 0, 48, 900);
		const { left, top } = computeCardPosition(spot, 400, 240);
		expect(left).toBe(60); // spot.right + 12
		expect(top).toBe(24);
	});

	it("places the card LEFT of a full-height right sidebar", () => {
		const spot = rect(1140, 0, 300, 900);
		const { left } = computeCardPosition(spot, 400, 240);
		expect(left).toBe(1140 - 12 - 400);
	});

	it("falls back to centered when nothing fits (full-width composer)", () => {
		const spot = rect(0, 620, 1440, 150);
		const { left, top } = computeCardPosition(spot, 400, 240);
		expect(left).toBe(Math.max(12, (1440 - 400) / 2));
		expect(top).toBeGreaterThanOrEqual(12);
	});

	it("sits below a mid-screen spotlight", () => {
		const spot = rect(300, 200, 380, 220);
		const { left, top } = computeCardPosition(spot, 400, 240);
		expect(top).toBe(432); // spot.bottom + 12
		expect(left).toBe(300 + (380 - 400) / 2); // anchored to the middle
	});

	it("never overflows a cramped window", () => {
		win(640, 480);
		const spot = rect(0, 0, 48, 480);
		const { left, top } = computeCardPosition(spot, 400, 240);
		expect(left).toBeGreaterThanOrEqual(12);
		expect(top).toBeGreaterThanOrEqual(12);
	});
});
