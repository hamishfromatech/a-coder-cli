/**
 * Natural-language schedule parsing for scheduled tasks.
 *
 * Models are good at understanding the user but unreliable at date math. This
 * parser turns the common scheduling phrases people actually use into the
 * structured CronSchedule the service fires:
 *
 *   every 30 minutes        -> every 30m
 *   every weekday at 9am    -> weekly Mon-Fri 09:00
 *   every Monday at 10:00   -> weekly Monday 10:00
 *   daily at 6pm            -> daily 18:00
 *   tomorrow at 2pm         -> once
 *   in 2 hours              -> once
 *   after each turn         -> event turn_end
 *   when a commit lands     -> event git_commit
 *
 * Times are local to the machine running the agent.
 */

import { describeSchedule, describeWeekdays, isValidDailyTime, isValidWeekdays } from "../office/errands.ts";
import type { CronSchedule } from "./types.ts";

export interface ParsedCronSchedule {
	schedule: CronSchedule;
	description: string;
}

export class CronScheduleParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "CronScheduleParseError";
	}
}

const DAY_ALIASES: Record<string, number> = {
	sunday: 0,
	sun: 0,
	monday: 1,
	mon: 1,
	tuesday: 2,
	tue: 2,
	tues: 2,
	wednesday: 3,
	wed: 3,
	thursday: 4,
	thu: 4,
	thur: 4,
	thurs: 4,
	friday: 5,
	fri: 5,
	saturday: 6,
	sat: 6,
};

const DAY_NAME_PATTERN = new RegExp(
	`\\b(${Object.keys(DAY_ALIASES)
		.sort((a, b) => b.length - a.length)
		.join("|")})\\b`,
	"g",
);

const PERIOD_TIMES: Array<{ pattern: RegExp; time: string }> = [
	{ pattern: /\bmorning\b|\bbreakfast\b/, time: "09:00" },
	{ pattern: /\bafternoon\b|\blunch(time)?\b/, time: "14:00" },
	{ pattern: /\bevening\b|\bsunset\b|\bdinner\b/, time: "18:00" },
	{ pattern: /\bnight\b|\bnightly\b|\bbedtime\b/, time: "21:00" },
];

interface TimeOfDay {
	hour: number;
	minute: number;
}

function normalize(input: string): string {
	return input
		.toLowerCase()
		.replace(/[—–]/g, "-")
		.replace(/\s+/g, " ")
		.replace(/^[\s,.;:]+|[\s,.;:]+$/g, "")
		.trim();
}

function validTime(hour: number, minute: number): TimeOfDay | undefined {
	if (!Number.isInteger(hour) || !Number.isInteger(minute)) return undefined;
	if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined;
	return { hour, minute };
}

function from12Hour(hour: number, minute: number, meridiem: string): TimeOfDay | undefined {
	if (hour < 1 || hour > 12) return undefined;
	const normalizedHour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
	return validTime(normalizedHour, minute);
}

/** Parse a clock time from free text. Returns the first time it finds. */
export function parseTimeOfDay(input: string): TimeOfDay | undefined {
	const text = normalize(input);
	if (/\bnoon\b/.test(text)) return { hour: 12, minute: 0 };
	if (/\bmidnight\b/.test(text)) return { hour: 0, minute: 0 };

	const meridiem = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/.exec(text);
	if (meridiem) {
		return from12Hour(
			Number.parseInt(meridiem[1], 10),
			meridiem[2] ? Number.parseInt(meridiem[2], 10) : 0,
			meridiem[3],
		);
	}

	const colon = /\b(\d{1,2}):(\d{2})\b/.exec(text);
	if (colon) {
		return validTime(Number.parseInt(colon[1], 10), Number.parseInt(colon[2], 10));
	}

	const at = /\bat\s+(\d{1,2})\b/.exec(text);
	if (at) return validTime(Number.parseInt(at[1], 10), 0);

	return undefined;
}

function timeFromPeriod(text: string): string | undefined {
	for (const period of PERIOD_TIMES) {
		if (period.pattern.test(text)) return period.time;
	}
	return undefined;
}

/** Parse a weekday list such as "mon,wed,fri", "1,3,5", or "weekdays". */
export function parseDayList(input: string): number[] | undefined {
	const text = normalize(input);
	if (/\bweekdays?\b/.test(text)) return [1, 2, 3, 4, 5];
	if (/\bweekends?\b/.test(text)) return [0, 6];
	if (/\b(every|each)\s+day\b|\bdaily\b/.test(text)) return [0, 1, 2, 3, 4, 5, 6];

	const named = Array.from(text.matchAll(DAY_NAME_PATTERN)).map((match) => DAY_ALIASES[match[1]]);
	if (named.length > 0) return Array.from(new Set(named)).sort();

	const numeric = text
		.split(/[^0-9]+/)
		.filter(Boolean)
		.map((value) => Number.parseInt(value, 10));
	if (numeric.length > 0 && numeric.every((day) => Number.isInteger(day) && day >= 0 && day <= 6)) {
		return Array.from(new Set(numeric)).sort();
	}
	return undefined;
}

function buildWeekly(days: number[], time: string): CronSchedule {
	return { kind: "weekly", days: [...new Set(days)].sort((a, b) => a - b), time };
}

function nextDateAt(now: number, year: number, monthIndex: number, day: number, time: TimeOfDay): Date | undefined {
	const date = new Date(year, monthIndex, day, time.hour, time.minute, 0, 0);
	if (date.getFullYear() !== year || date.getMonth() !== monthIndex || date.getDate() !== day) return undefined;
	if (date.getTime() <= now) return undefined;
	return date;
}

function parseOnce(text: string, now: number, time: TimeOfDay | undefined): CronSchedule | undefined {
	const inMatch = /\bin\s+(\d+)\s*(minutes?|mins?|m|hours?|hrs?|h|days?|d)\b/.exec(text);
	if (inMatch) {
		const amount = Number.parseInt(inMatch[1], 10);
		const unit = inMatch[2];
		const multiplier = unit.startsWith("h") ? 3_600_000 : unit.startsWith("d") ? 86_400_000 : 60_000;
		return { kind: "once", at: now + amount * multiplier };
	}

	const relativeDay = /\b(today|tomorrow)\b/.exec(text);
	if (relativeDay) {
		const clock = time ?? parseTimeOfDay(text) ?? { hour: 9, minute: 0 };
		const date = new Date(now);
		date.setDate(date.getDate() + (relativeDay[1] === "tomorrow" ? 1 : 0));
		date.setHours(clock.hour, clock.minute, 0, 0);
		if (date.getTime() <= now) {
			throw new CronScheduleParseError("That time has already passed today. Use tomorrow or a future date.");
		}
		return { kind: "once", at: date.getTime() };
	}

	const iso = /\b(\d{4})-(\d{2})-(\d{2})(?:[ t](\d{1,2}):(\d{2}))?\b/.exec(text);
	if (iso) {
		const clock = iso[4]
			? validTime(Number.parseInt(iso[4], 10), Number.parseInt(iso[5], 10))
			: (time ?? { hour: 9, minute: 0 });
		if (!clock) throw new CronScheduleParseError("The date has an invalid time.");
		const date = nextDateAt(
			now,
			Number.parseInt(iso[1], 10),
			Number.parseInt(iso[2], 10) - 1,
			Number.parseInt(iso[3], 10),
			clock,
		);
		if (!date) throw new CronScheduleParseError("That date is in the past or invalid.");
		return { kind: "once", at: date.getTime() };
	}

	const monthMatch =
		/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(\d{4}))?\b/.exec(
			text,
		);
	if (monthMatch) {
		const month = new Date(`${monthMatch[1]} 1, 2000`).getMonth();
		const day = Number.parseInt(monthMatch[2], 10);
		const clock = time ?? parseTimeOfDay(text) ?? { hour: 9, minute: 0 };
		const requestedYear = monthMatch[3] ? Number.parseInt(monthMatch[3], 10) : new Date(now).getFullYear();
		let date = nextDateAt(now, requestedYear, month, day, clock);
		if (!date && !monthMatch[3]) date = nextDateAt(now, requestedYear + 1, month, day, clock);
		if (!date) throw new CronScheduleParseError("That date is in the past or invalid.");
		return { kind: "once", at: date.getTime() };
	}

	return undefined;
}

/**
 * Parse a natural-language schedule. Throws CronScheduleParseError when the
 * phrase is not specific enough; callers should ask the user rather than
 * silently picking a time.
 */
export function parseNaturalSchedule(input: string, now = Date.now()): ParsedCronSchedule {
	const text = normalize(input);
	if (!text) throw new CronScheduleParseError("A schedule is required.");

	// Event-triggered work has no clock time.
	if (
		/\bon\s+(?:a\s+|the\s+)?turn(?:\s+end|s?\s+end)?\b/.test(text) ||
		/\bafter\s+(?:each|every|a|the)?\s*(?:turn|response|reply)\b/.test(text) ||
		/\bwhen\s+(?:a\s+|the\s+)?(?:turn|response|reply)\s+(?:ends|finishes|completes)\b/.test(text) ||
		/\b(every time|whenever)\b.*\b(?:turn|response|reply)\b/.test(text) ||
		/\bevery\s+(?:turn|response|reply)\b/.test(text)
	) {
		const schedule: CronSchedule = { kind: "event", trigger: "turn_end" };
		return { schedule, description: describeSchedule(schedule) };
	}
	if (
		/\bon\s+(?:a\s+|the\s+)?commit\b/.test(text) ||
		/\bafter\s+(?:each|every|a|the)?\s*commit\b/.test(text) ||
		/\bwhen\s+(?:a\s+|the\s+)?commit\b/.test(text) ||
		/\bwhen\s+(?:i|you|we)\s+commit\b/.test(text) ||
		/\b(every time|whenever)\b.*\bcommit\b/.test(text) ||
		/\bevery\s+commit\b/.test(text)
	) {
		const schedule: CronSchedule = { kind: "event", trigger: "git_commit" };
		return { schedule, description: describeSchedule(schedule) };
	}

	// Intervals. Keep "every day"/"daily" for the daily branch below.
	const interval =
		/\bevery\s+(\d+)\s*(minutes?|mins?|m|hours?|hrs?|h|days?|d)\b/.exec(text) ??
		/^(\d+)\s*(minutes?|mins?|m|hours?|hrs?|h|days?|d)$/.exec(text) ??
		/\bevery\s+(minute|hour)\b/.exec(text);
	if (interval) {
		if (interval[1] && !/^\d+$/.test(interval[1])) {
			const unit = interval[1];
			const minutes = unit === "hour" ? 60 : unit === "day" ? 1_440 : 1;
			const schedule: CronSchedule = { kind: "every", minutes };
			return { schedule, description: describeSchedule(schedule) };
		}
		if (interval[1]) {
			const amount = Number.parseInt(interval[1], 10);
			const unit = interval[2];
			const minutes = unit.startsWith("h") ? amount * 60 : unit.startsWith("d") ? amount * 1_440 : amount;
			const schedule: CronSchedule = { kind: "every", minutes };
			return { schedule, description: describeSchedule(schedule) };
		}
	}

	if (/\bhourly\b/.test(text)) {
		const schedule: CronSchedule = { kind: "every", minutes: 60 };
		return { schedule, description: describeSchedule(schedule) };
	}

	const time = parseTimeOfDay(text);

	// One-shot phrases must be checked before weekly numeric parsing.
	const once = parseOnce(text, now, time);
	if (once) return { schedule: once, description: describeSchedule(once) };

	// Weekly: weekdays, weekends, or named days. This must run before the
	// daily branch so "every weekday" is not treated as "every day".
	const weeklyDays = parseDayList(text);
	if (weeklyDays && !/\b(every|each)\s+day\b|\bdaily\b/.test(text)) {
		const weeklyTime = time ?? { hour: 9, minute: 0 };
		const schedule = buildWeekly(
			weeklyDays,
			`${String(weeklyTime.hour).padStart(2, "0")}:${String(weeklyTime.minute).padStart(2, "0")}`,
		);
		return { schedule, description: describeSchedule(schedule) };
	}

	// Daily phrases, including "every morning" / "nightly".
	if (/\b(daily|every day|each day|nightly)\b/.test(text) || timeFromPeriod(text)) {
		const periodTime = timeFromPeriod(text);
		const dailyTime = time
			? `${String(time.hour).padStart(2, "0")}:${String(time.minute).padStart(2, "0")}`
			: (periodTime ?? "09:00");
		if (!isValidDailyTime(dailyTime)) {
			throw new CronScheduleParseError("The time must be between 00:00 and 23:59.");
		}
		const schedule: CronSchedule = { kind: "daily", time: dailyTime };
		return { schedule, description: describeSchedule(schedule) };
	}

	// A bare time is ambiguous between daily and one-shot; ask instead of guessing.
	if (time) {
		throw new CronScheduleParseError(
			'Please say whether that time is daily/weekly or a one-off (for example "daily at 9am" or "tomorrow at 9am").',
		);
	}

	throw new CronScheduleParseError(
		'Could not read that schedule. Try "every 30 minutes", "every weekday at 9am", "daily at 6pm", or "tomorrow at 2pm".',
	);
}

/** Short, human-readable job name derived from the task text. */
export function deriveScheduleName(task: string): string {
	const sentence =
		task
			.trim()
			.split(/[.!?\n]/)[0]
			?.trim() ?? "";
	const clipped = sentence.length > 64 ? `${sentence.slice(0, 61).trimEnd()}...` : sentence;
	if (!clipped) return "Scheduled task";
	return clipped.charAt(0).toUpperCase() + clipped.slice(1);
}

/** Format a weekly schedule from parsed days/time (used by the CLI). */
export function formatWeeklySchedule(days: number[], time: string): string {
	if (!isValidWeekdays(days) || !isValidDailyTime(time)) {
		throw new CronScheduleParseError("Weekly schedules need at least one day and an HH:MM time.");
	}
	return `weekly on ${describeWeekdays(days)} at ${time}`;
}
