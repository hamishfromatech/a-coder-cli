/**
 * Chat timestamps: show the local send time, adding a day/date only when the
 * message is not from today. Minute precision is enough inside a conversation;
 * the full value stays available to callers that render a tooltip.
 */
function isSameLocalDay(a: Date, b: Date): boolean {
	return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const timeFormatters = new Map<string, Intl.DateTimeFormat>();
const dateFormatters = new Map<string, Intl.DateTimeFormat>();

function getTimeFormatter(locale?: string): Intl.DateTimeFormat {
	const key = locale ?? "";
	let formatter = timeFormatters.get(key);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat(locale, { hour: "numeric", minute: "2-digit" });
		timeFormatters.set(key, formatter);
	}
	return formatter;
}

function getDateFormatter(locale: string | undefined, withYear: boolean): Intl.DateTimeFormat {
	const key = `${locale ?? ""}:${withYear ? "year" : "short"}`;
	let formatter = dateFormatters.get(key);
	if (!formatter) {
		formatter = new Intl.DateTimeFormat(locale, {
			month: "short",
			day: "numeric",
			...(withYear ? { year: "numeric" } : {}),
		});
		dateFormatters.set(key, formatter);
	}
	return formatter;
}

export function formatMessageTimestamp(
	timestamp: number | undefined,
	now: number = Date.now(),
	locale?: string,
): string {
	if (typeof timestamp !== "number" || !Number.isFinite(timestamp) || timestamp <= 0) return "";
	const date = new Date(timestamp);
	if (Number.isNaN(date.getTime())) return "";

	const current = new Date(now);
	const time = getTimeFormatter(locale).format(date);

	if (isSameLocalDay(date, current)) return time;

	const yesterday = new Date(current.getFullYear(), current.getMonth(), current.getDate() - 1);
	if (isSameLocalDay(date, yesterday)) return `Yesterday ${time}`;

	const datePart = getDateFormatter(locale, date.getFullYear() !== current.getFullYear()).format(date);
	return `${datePart}, ${time}`;
}
