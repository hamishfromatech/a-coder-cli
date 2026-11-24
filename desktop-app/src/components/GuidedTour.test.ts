import { afterEach, describe, expect, it } from "vitest";

const { computeCardPosition, computeSpotlightCutout, computeSpotlightPanels } = await import(
	"../components/GuidedTour"
);

const rect = (left: number, top: number, width: number, height: number) =>
	({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;

const win = (vw: number, vh: number) => {
	Object.defineProperty(window, "innerWidth", { value: vw, configurable: true });
	Object.defineProperty(window, "innerHeight", { value: vh, configurable: true });
};

describe("computeSpotlightPanels", () => {
	afterEach(() => win(1440, 900));

	it("covers the viewport outside a mid-screen cutout exactly once", () => {
		win(1440, 900);
		const spot = rect(300, 200, 380, 220);
		const panels = computeSpotlightPanels(spot);
		expect(panels).toEqual([
			{ left: 0, top: 0, width: 1440, height: 194 },
			{ left: 0, top: 426, width: 1440, height: 474 },
			{ left: 0, top: 194, width: 294, height: 232 },
			{ left: 686, top: 194, width: 754, height: 232 },
		]);
		const area = panels.reduce((sum, p) => sum + p.width * p.height, 0);
		// Cutout is 392 x 232; the four panels tile the rest of the viewport.
		expect(area).toBe(1440 * 900 - 392 * 232);
	});

	it("leaves no top/bottom band for a full-height rail", () => {
		win(1440, 900);
		const panels = computeSpotlightPanels(rect(0, 0, 48, 900));
		expect(panels[0]!.height).toBe(0);
		expect(panels[1]!.height).toBe(0);
		expect(panels[2]!.width).toBe(0);
		expect(panels[3]).toEqual({ left: 54, top: 0, width: 1386, height: 900 });
	});

	it("clamps a cutout that hangs off the viewport edges", () => {
		win(640, 480);
		expect(computeSpotlightCutout(rect(-40, -30, 100, 100))).toEqual({
			left: 0,
			top: 0,
			width: 66,
			height: 76,
		});
		const panels = computeSpotlightPanels(rect(-40, -30, 100, 100));
		for (const panel of panels) {
			expect(panel.width).toBeGreaterThanOrEqual(0);
			expect(panel.height).toBeGreaterThanOrEqual(0);
			expect(panel.left).toBeGreaterThanOrEqual(0);
			expect(panel.top).toBeGreaterThanOrEqual(0);
			expect(panel.left + panel.width).toBeLessThanOrEqual(640);
			expect(panel.top + panel.height).toBeLessThanOrEqual(480);
		}
	});
});

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
