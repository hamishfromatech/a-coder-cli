/**
 * Errand schedule math — pure next-fire computation for the office's
 * scheduled jobs.
 *
 * Three errand schedule kinds:
 *   every:  interval of N minutes (minimum 5, clamped)
 *   daily:  once per day at a local HH:MM
 *   once:   a single fire at an epoch-ms timestamp
 *
 * The shared math also accepts weekly (cron jobs) and event schedules.
 */

import type { ErrandSchedule } from "./types.ts";

/** Minimum interval for "every" schedules — protects the engine from a
 *  misconfigured tight loop. */
export const MIN_INTERVAL_MINUTES = 5;

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Event-triggered schedules (cron Loops-style jobs) — fired by host events,
 *  never by time. The office never creates these; the math accepts them so
 *  the cron service can share this module. */
export interface EventScheduleLike {
	kind: "event";
	trigger: string;
	cooldownMinutes?: number;
}

/** Weekly schedules (cron jobs) use JavaScript day numbers: 0 = Sunday. */
export interface WeeklyScheduleLike {
	kind: "weekly";
	days: number[];
	time: string;
}

export type ScheduleLike = ErrandSchedule | EventScheduleLike | WeeklyScheduleLike;

export const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
export const DAY_NAMES_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/** Human-readable day list (Sunday first, then Monday...). */
export function describeWeekdays(days: number[]): string {
	const unique = Array.from(new Set(days.filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))).sort();
	if (unique.length === 7) return "every day";
	if (unique.length === 5 && unique.every((day) => day >= 1 && day <= 5)) return "weekdays";
	if (unique.length === 2 && unique.includes(0) && unique.includes(6)) return "weekends";
	return unique.map((day) => DAY_NAMES_SHORT[day]).join(", ");
}

/** Validate weekly day numbers. */
export function isValidWeekdays(days: unknown): days is number[] {
	return (
		Array.isArray(days) &&
		days.length > 0 &&
		days.every((day) => typeof day === "number" && Number.isInteger(day) && day >= 0 && day <= 6)
	);
}

/** Validate a "HH:MM" local-time string. */
export function isValidDailyTime(time: string): boolean {
	return /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

/** Compute the first fire strictly after `from` (epoch ms). Event schedules
 *  have no time-based next fire (undefined). */
export function nextRunAt(schedule: ScheduleLike, from: number): number | undefined {
	if (schedule.kind === "event") {
		return undefined;
	}
	if (schedule.kind === "once") {
		return schedule.at > from ? schedule.at : undefined;
	}

	if (schedule.kind === "every") {
		const minutes = Math.max(MIN_INTERVAL_MINUTES, Math.floor(schedule.minutes));
		return from + minutes * 60_000;
	}

	if (schedule.kind === "weekly") {
		if (!isValidDailyTime(schedule.time) || !isValidWeekdays(schedule.days)) return undefined;
		const [hourStr, minuteStr] = schedule.time.split(":");
		const hour = Number.parseInt(hourStr, 10);
		const minute = Number.parseInt(minuteStr, 10);
		const start = new Date(from);
		let best: number | undefined;
		for (const day of new Set(schedule.days)) {
			for (let offset = 0; offset <= 7; offset++) {
				const candidate = new Date(start);
				candidate.setDate(start.getDate() + offset);
				candidate.setHours(hour, minute, 0, 0);
				if (candidate.getDay() !== day || candidate.getTime() <= from) continue;
				if (best === undefined || candidate.getTime() < best) best = candidate.getTime();
				break;
			}
		}
		return best;
	}

	// daily: next occurrence of HH:MM local time after `from`.
	if (!isValidDailyTime(schedule.time)) {
		return undefined;
	}
	const [hourStr, minuteStr] = schedule.time.split(":");
	const hour = Number.parseInt(hourStr, 10);
	const minute = Number.parseInt(minuteStr, 10);
	const fire = new Date(from);
	fire.setHours(hour, minute, 0, 0);
	if (fire.getTime() <= from) {
		fire.setTime(fire.getTime() + DAY_MS);
	}
	return fire.getTime();
}

/** Human-readable schedule line for the roster. */
export function describeSchedule(schedule: ScheduleLike): string {
	if (schedule.kind === "event") {
		if (schedule.trigger === "turn_end") return "on turn end";
		if (schedule.trigger === "git_commit") return "on commit";
		return `on ${schedule.trigger.replace(/_/g, " ")}`;
	}
	if (schedule.kind === "once") {
		return new Date(schedule.at).toLocaleString();
	}
	if (schedule.kind === "every") {
		const minutes = Math.max(MIN_INTERVAL_MINUTES, Math.floor(schedule.minutes));
		if (minutes % (60 * 24) === 0) return `every ${minutes / (60 * 24)}d`;
		if (minutes % 60 === 0) return `every ${minutes / 60}h`;
		return `every ${minutes}m`;
	}
	if (schedule.kind === "weekly") {
		return `weekly on ${describeWeekdays(schedule.days)} at ${schedule.time}`;
	}
	return `daily at ${schedule.time}`;
}

/** Whether an errand is due as of `now` and enabled. Event schedules are
 *  never time-due — the host fires them through notifyEvent. */
export function isDue(errand: { enabled: boolean; schedule: ScheduleLike; nextRunAt?: number }, now: number): boolean {
	if (!errand.enabled) return false;
	if (errand.schedule.kind === "event") return false;
	const next = errand.nextRunAt ?? nextRunAt(errand.schedule, now);
	return next !== undefined && next <= now;
}
