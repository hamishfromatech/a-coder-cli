import { weeklyReport, monthlyReport, quarterlyReport } from "./lib/reports.js";

const events = [
	{ t: "2026-01-05T10:00:00.000Z", label: "deploy" },
	{ t: "2026-01-20T12:00:00.000Z", label: "incident" },
	{ t: "2026-02-10T08:30:00.000Z", label: "release" },
	{ t: "2026-03-01T16:00:00.000Z", label: "audit" },
];

console.log(weeklyReport("2026-01-01", "2026-01-31", events));
console.log(monthlyReport("2026-02-01", "2026-02-28", events));
console.log(quarterlyReport("2026-03-15", "2026-01-01", events)); // reversed on purpose
console.log(weeklyReport(null, null, events));