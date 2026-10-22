/**
 * Natural-language schedule parsing — deterministic time math behind the
 * schedule_task tool and the CLI's plain-English scheduling path.
 */

import { describe, expect, it } from "vitest";
import {
	CronScheduleParseError,
	deriveScheduleName,
	parseDayList,
	parseNaturalSchedule,
	parseTimeOfDay,
} from "../src/core/cron/schedule-parser.ts";
import { describeSchedule, nextRunAt } from "../src/core/office/errands.ts";

// Wednesday 21 October 2026, 08:00 local.
const NOW = new Date(2026, 9, 21, 8, 0, 0, 0).getTime();

describe("schedule parser", () => {
	it("parses intervals", () => {
		expect(parseNaturalSchedule("every 30 minutes", NOW).schedule).toEqual({ kind: "every", minutes: 30 });
		expect(parseNaturalSchedule("every 2 hours", NOW).schedule).toEqual({ kind: "every", minutes: 120 });
		expect(parseNaturalSchedule("every hour", NOW).schedule).toEqual({ kind: "every", minutes: 60 });
		expect(parseNaturalSchedule("hourly", NOW).schedule).toEqual({ kind: "every", minutes: 60 });
	});

	it("parses daily phrases with local times", () => {
		expect(parseNaturalSchedule("daily at 6pm", NOW).schedule).toEqual({ kind: "daily", time: "18:00" });
		expect(parseNaturalSchedule("every day at 9:30", NOW).schedule).toEqual({ kind: "daily", time: "09:30" });
		expect(parseNaturalSchedule("every morning", NOW).schedule).toEqual({ kind: "daily", time: "09:00" });
		expect(parseNaturalSchedule("nightly", NOW).schedule).toEqual({ kind: "daily", time: "21:00" });
	});

	it("parses weekdays, weekends, and named days", () => {
		expect(parseNaturalSchedule("every weekday at 9am", NOW).schedule).toEqual({
			kind: "weekly",
			days: [1, 2, 3, 4, 5],
			time: "09:00",
		});
		expect(parseNaturalSchedule("every weekend at 10am", NOW).schedule).toEqual({
			kind: "weekly",
			days: [0, 6],
			time: "10:00",
		});
		expect(parseNaturalSchedule("Monday, Wednesday and Friday at 9am", NOW).schedule).toEqual({
			kind: "weekly",
			days: [1, 3, 5],
			time: "09:00",
		});
		expect(parseNaturalSchedule("every Mon at 14:30", NOW).schedule).toEqual({
			kind: "weekly",
			days: [1],
			time: "14:30",
		});
	});

	it("computes the next weekly fire strictly in the future", () => {
		const parsed = parseNaturalSchedule("every weekday at 9am", NOW);
		const next = nextRunAt(parsed.schedule, NOW);
		expect(next).toBeDefined();
		const date = new Date(next!);
		expect(date.getDay()).toBeGreaterThanOrEqual(1);
		expect(date.getDay()).toBeLessThanOrEqual(5);
		expect(date.getHours()).toBe(9);
		expect(date.getMinutes()).toBe(0);
		expect(next).toBeGreaterThan(NOW);

		const monday = nextRunAt({ kind: "weekly", days: [1], time: "10:00" }, NOW);
		expect(new Date(monday!).getDay()).toBe(1);
		expect(monday).toBeGreaterThan(NOW);
	});

	it("parses one-shot phrases", () => {
		expect(parseNaturalSchedule("in 2 hours", NOW).schedule).toEqual({ kind: "once", at: NOW + 7_200_000 });
		expect(parseNaturalSchedule("tomorrow at 2pm", NOW).schedule).toEqual({
			kind: "once",
			at: new Date(2026, 9, 22, 14, 0, 0, 0).getTime(),
		});
		expect(parseNaturalSchedule("on 2026-10-24 at 09:00", NOW).schedule).toEqual({
			kind: "once",
			at: new Date(2026, 9, 24, 9, 0, 0, 0).getTime(),
		});
	});

	it("parses event triggers", () => {
		expect(parseNaturalSchedule("after each turn", NOW).schedule).toEqual({ kind: "event", trigger: "turn_end" });
		expect(parseNaturalSchedule("when a commit lands", NOW).schedule).toEqual({
			kind: "event",
			trigger: "git_commit",
		});
	});

	it("rejects ambiguous or incomplete timing", () => {
		expect(() => parseNaturalSchedule("at 9am", NOW)).toThrow(CronScheduleParseError);
		expect(() => parseNaturalSchedule("regularly", NOW)).toThrow(/Could not read/);
		expect(() => parseNaturalSchedule("today at 7am", NOW)).toThrow(/already passed/);
	});

	it("parses clock times and day lists", () => {
		expect(parseTimeOfDay("9:30 pm")).toEqual({ hour: 21, minute: 30 });
		expect(parseTimeOfDay("12am")).toEqual({ hour: 0, minute: 0 });
		expect(parseTimeOfDay("noon")).toEqual({ hour: 12, minute: 0 });
		expect(parseDayList("mon,wed,fri")).toEqual([1, 3, 5]);
		expect(parseDayList("weekdays")).toEqual([1, 2, 3, 4, 5]);
		expect(describeSchedule({ kind: "weekly", days: [1, 3, 5], time: "09:00" })).toBe(
			"weekly on Mon, Wed, Fri at 09:00",
		);
	});

	it("derives a short task name", () => {
		expect(deriveScheduleName("Review the open CI failures. Post a summary.")).toBe("Review the open CI failures");
		expect(deriveScheduleName("")).toBe("Scheduled task");
	});
});
