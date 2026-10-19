import { describe, expect, it } from "vitest";
import { micThreshold, normalizeMicLevel, normalizeOutputLevel } from "./voice-level";

describe("voice level", () => {
	it("lowers the mic threshold as sensitivity rises", () => {
		expect(micThreshold(0.01, 1)).toBeLessThan(micThreshold(0.01, 0));
	});

	it("keeps the threshold above a loud noise floor", () => {
		expect(micThreshold(0.08, 1)).toBeGreaterThan(0.08);
	});

	it("normalizes mic speech above the floor without clipping", () => {
		expect(normalizeMicLevel(0.01, 0.01, 0.05)).toBe(0);
		expect(normalizeMicLevel(0.06, 0.01, 0.05)).toBeGreaterThan(0.5);
		expect(normalizeMicLevel(1, 0.01, 0.05)).toBe(1);
	});

	it("boosts quiet TTS and clamps loud TTS", () => {
		expect(normalizeOutputLevel(0.02)).toBeGreaterThan(0.3);
		expect(normalizeOutputLevel(0.5)).toBe(1);
	});
});
