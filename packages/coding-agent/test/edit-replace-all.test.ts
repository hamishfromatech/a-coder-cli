import { describe, expect, it } from "vitest";
import { computeRetryDelayMs } from "../src/core/agent-session.ts";
import { applyEditsToNormalizedContent, type Edit } from "../src/core/tools/edit-diff.ts";

describe("edit replaceAll", () => {
	it("replaces every occurrence when replaceAll is set", () => {
		const content = "alpha alpha beta alpha\nline alpha";
		const edits: Edit[] = [{ oldText: "alpha", newText: "x", replaceAll: true }];
		const result = applyEditsToNormalizedContent(content, edits, "f.ts");
		expect(result.newContent).toBe("x x beta x\nline x");
	});

	it("keeps unique-match semantics by default", () => {
		const content = "alpha alpha";
		const edits: Edit[] = [{ oldText: "alpha", newText: "x" }];
		expect(() => applyEditsToNormalizedContent(content, edits, "f.ts")).toThrow(
			/Found 2 occurrences.*must be unique/s,
		);
	});

	it("fails with not-found when replaceAll has no occurrences", () => {
		const result = () =>
			applyEditsToNormalizedContent("alpha", [{ oldText: "zzz", newText: "x", replaceAll: true }], "f.ts");
		expect(result).toThrow(/Could not find the exact text/);
	});

	it("detects overlap between a replaceAll edit and another edit", () => {
		const content = "alpha alpha beta";
		const edits: Edit[] = [
			{ oldText: "beta", newText: "B" },
			{ oldText: "alpha", newText: "x", replaceAll: true },
		];
		expect(() => applyEditsToNormalizedContent(content, edits, "f.ts")).not.toThrow();
		expect(applyEditsToNormalizedContent(content, edits, "f.ts").newContent).toBe("x x B");

		const overlapping: Edit[] = [
			{ oldText: "alpha beta", newText: "C" },
			{ oldText: "alpha", newText: "x", replaceAll: true },
		];
		expect(() => applyEditsToNormalizedContent("alpha alpha beta", overlapping, "f.ts")).toThrow(/overlap/);
	});

	it("replaces in fuzzy-normalized space when the old text fuzzy-matches", () => {
		// Smart quotes normalize to ASCII for the fuzzy domain.
		const content = "don\u2019t stop don\u2019t stop";
		const edits: Edit[] = [{ oldText: "don't stop", newText: "go", replaceAll: true }];
		const result = applyEditsToNormalizedContent(content, edits, "f.ts");
		expect(result.newContent).toBe("go go");
	});
});

describe("computeRetryDelayMs", () => {
	it("grows exponentially with ±25% jitter", () => {
		for (const random of [0, 0.5, 0.999]) {
			const delay = computeRetryDelayMs(1000, 3, () => random);
			expect(delay).toBeGreaterThanOrEqual(3000);
			expect(delay).toBeLessThanOrEqual(5000);
		}
	});

	it("caps the delay at 60s before applying jitter", () => {
		for (let attempt = 1; attempt <= 20; attempt++) {
			const delay = computeRetryDelayMs(30_000, attempt, () => 0.999);
			expect(delay).toBeLessThanOrEqual(90_000);
		}
		expect(computeRetryDelayMs(30_000, 10, () => 0)).toBe(45_000);
	});

	it("never returns less than 1ms", () => {
		expect(computeRetryDelayMs(1, 1, () => 0)).toBeGreaterThanOrEqual(1);
	});
});
