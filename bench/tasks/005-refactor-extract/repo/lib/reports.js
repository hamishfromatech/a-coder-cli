/**
 * Report generators. Each clamps an optional date range to valid ISO bounds
 * and produces a labeled report line.
 */

function startOfDayIso(iso) {
	const d = new Date(iso);
	d.setUTCHours(0, 0, 0, 0);
	return d.toISOString();
}

function endOfDayIso(iso) {
	const d = new Date(iso);
	d.setUTCHours(23, 59, 59, 999);
	return d.toISOString();
}

export function weeklyReport(startIso, endIso, events) {
	let start = startIso;
	let end = endIso;
	if (start && end && new Date(start) > new Date(end)) {
		[start, end] = [end, start];
	}
	if (start) start = startOfDayIso(start);
	if (end) end = endOfDayIso(end);
	const filtered = events.filter((e) => (!start || e.t >= start) && (!end || e.t <= end));
	return `weekly: ${filtered.length} events (${start ?? "beginning"} .. ${end ?? "now"})`;
}

export function monthlyReport(startIso, endIso, events) {
	let start = startIso;
	let end = endIso;
	if (start && end && new Date(start) > new Date(end)) {
		[start, end] = [end, start];
	}
	if (start) start = startOfDayIso(start);
	if (end) end = endOfDayIso(end);
	const filtered = events.filter((e) => (!start || e.t >= start) && (!end || e.t <= end));
	return `monthly: ${filtered.length} events (${start ?? "beginning"} .. ${end ?? "now"})`;
}

export function quarterlyReport(startIso, endIso, events) {
	let start = startIso;
	let end = endIso;
	if (start && end && new Date(start) > new Date(end)) {
		[start, end] = [end, start];
	}
	if (start) start = startOfDayIso(start);
	if (end) end = endOfDayIso(end);
	const filtered = events.filter((e) => (!start || e.t >= start) && (!end || e.t <= end));
	return `quarterly: ${filtered.length} events (${start ?? "beginning"} .. ${end ?? "now"})`;
}