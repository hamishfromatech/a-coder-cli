/**
 * Errand schedule math — pure next-fire computation for the office's
 * scheduled jobs.
 *
 * Three schedule kinds:
 *   every:  interval of N minutes (minimum 5, clamped)
 *   daily:  once per day at a local HH:MM
 *   once:   a single fire at an epoch-ms timestamp
 */

import type { ErrandSchedule } from "./types.ts";

/** Minimum interval for "every" schedules — protects the engine from a
 *  misconfigured tight loop. */
export const MIN_INTERVAL_MINUTES = 5;

export const DAY_MS = 24 * 60 * 60 * 1000;

/** Validate a "HH:MM" local-time string. */
export function isValidDailyTime(time: string): boolean {
	return /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
}

/** Compute the first fire strictly after `from` (epoch ms). */
export function nextRunAt(schedule: ErrandSchedule, from: number): number | undefined {
	if (schedule.kind === "once") {
		return schedule.at > from ? schedule.at : undefined;
	}

	if (schedule.kind === "every") {
		const minutes = Math.max(MIN_INTERVAL_MINUTES, Math.floor(schedule.minutes));
		return from + minutes * 60_000;
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
export function describeSchedule(schedule: ErrandSchedule): string {
	if (schedule.kind === "once") {
		return new Date(schedule.at).toLocaleString();
	}
	if (schedule.kind === "every") {
		const minutes = Math.max(MIN_INTERVAL_MINUTES, Math.floor(schedule.minutes));
		if (minutes % (60 * 24) === 0) return `every ${minutes / (60 * 24)}d`;
		if (minutes % 60 === 0) return `every ${minutes / 60}h`;
		return `every ${minutes}m`;
	}
	return `daily at ${schedule.time}`;
}

/** Whether an errand is due as of `now` and enabled. */
export function isDue(
	errand: { enabled: boolean; schedule: ErrandSchedule; nextRunAt?: number },
	now: number,
): boolean {
	if (!errand.enabled) return false;
	const next = errand.nextRunAt ?? nextRunAt(errand.schedule, now);
	return next !== undefined && next <= now;
}
