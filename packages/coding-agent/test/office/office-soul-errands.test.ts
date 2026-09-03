import { describe, expect, it } from "vitest";
import { describeSchedule, isValidDailyTime, nextRunAt } from "../../src/core/office/errands.ts";
import { composeSoul, handleFromName, identityReminder } from "../../src/core/office/soul.ts";
import type { Coworker } from "../../src/core/office/types.ts";

describe("handleFromName", () => {
	it("slugs names into lowercase handles", () => {
		expect(handleFromName("Atlas")).toBe("atlas");
		expect(handleFromName("Ada Lovelace")).toBe("ada-lovelace");
		expect(handleFromName("  R&D !! ")).toBe("r-d");
		expect(handleFromName("")).toBe("coworker");
	});
});

describe("composeSoul", () => {
	const roster: Coworker[] = [
		{
			id: "a1",
			name: "Atlas",
			handle: "atlas",
			title: "Scout",
			description: "Watches the repo",
			soul: "",
			face: { shape: "circle" },
			autonomy: "supervised",
			createdAt: 0,
			sessions: {},
		},
	];

	it("composes identity + collaboration for a new coworker", () => {
		const soul = composeSoul({ name: "Nova", title: "Maker", description: "Builds things", handle: "nova", roster });
		expect(soul).toContain("# Nova (Maker)");
		expect(soul).toContain("**Role:** Maker");
		expect(soul).toContain("**Mission:** Builds things");
		expect(soul).toContain("## Working with your office");
		expect(soul).toContain("- @atlas — Scout: Watches the repo");
	});

	it("uses custom soul text verbatim plus the collaboration section", () => {
		const soul = composeSoul({ name: "Nova", handle: "nova", roster, customSoul: "I am Nova, the quiet one." });
		expect(soul.startsWith("I am Nova, the quiet one.")).toBe(true);
		expect(soul).toContain("## Working with your office");
	});

	it("excludes the coworker itself and hidden coworkers from the teammate list", () => {
		const self = composeSoul({ name: "Atlas", handle: "atlas", roster });
		expect(self).not.toContain("@atlas — Scout");
	});
});

describe("identityReminder", () => {
	it("includes handle and role", () => {
		const coworker: Coworker = {
			id: "a1",
			name: "Atlas",
			handle: "atlas",
			title: "Scout",
			soul: "",
			face: { shape: "circle" },
			autonomy: "supervised",
			createdAt: 0,
			sessions: {},
		};
		expect(identityReminder(coworker)).toBe("You are @atlas (Atlas, Scout).");
	});
});

describe("errand schedules", () => {
	it("computes next interval fire strictly in the future", () => {
		const from = 1_000_000;
		expect(nextRunAt({ kind: "every", minutes: 15 }, from)).toBe(from + 15 * 60_000);
		// clamped to the 5-minute minimum
		expect(nextRunAt({ kind: "every", minutes: 1 }, from)).toBe(from + 5 * 60_000);
	});

	it("once schedules fire only in the future", () => {
		expect(nextRunAt({ kind: "once", at: 500 }, 1000)).toBeUndefined();
		expect(nextRunAt({ kind: "once", at: 1500 }, 1000)).toBe(1500);
	});

	it("daily schedules land at the next local HH:MM", () => {
		const from = new Date();
		from.setHours(10, 0, 0, 0);
		const next = nextRunAt({ kind: "daily", time: "09:00" }, from.getTime());
		expect(next).toBeDefined();
		const fire = new Date(next as number);
		expect(fire.getHours()).toBe(9);
		expect(fire.getTime()).toBeGreaterThan(from.getTime());
	});

	it("validates daily time strings", () => {
		expect(isValidDailyTime("09:30")).toBe(true);
		expect(isValidDailyTime("23:59")).toBe(true);
		expect(isValidDailyTime("24:00")).toBe(false);
		expect(isValidDailyTime("9:30")).toBe(false);
	});

	it("describes schedules for humans", () => {
		expect(describeSchedule({ kind: "every", minutes: 90 })).toBe("every 90m");
		expect(describeSchedule({ kind: "daily", time: "09:00" })).toBe("daily at 09:00");
		expect(describeSchedule({ kind: "once", at: 0 })).toContain(new Date(0).toLocaleString());
	});
});
