/**
 * Cron calendar — a month grid over the scheduled-tasks system so the
 * rhythm is visible at a glance: upcoming firings (daily/weekly/once jobs) and
 * past runs (status-colored dots) per day, with a selected-day detail
 * listing both. Interval and event-trigger jobs have no natural calendar
 * day, so they render in an "ongoing" strip under the grid; their past
 * runs still show as dots and in day details.
 */

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, History, Hourglass, Zap } from "lucide-react";
import { Button } from "../ui/Button";
import type { CronJob, CronRun } from "../../lib/rpc";
import { useCronStore } from "../../stores/cron-store";
import { openSessionFile } from "../../lib/open-session";

/** Local-date key (YYYY-MM-DD) — not toISOString, which is UTC. */
function dayKey(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, "0");
	const d = String(date.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

function timeOfDay(ms: number): string {
	return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** "daily 09:30" or "weekly 09:30" firing time as local {h, m}, or null. */
function scheduledTime(job: CronJob): { h: number; m: number } | null {
	if (job.schedule.kind !== "daily" && job.schedule.kind !== "weekly") return null;
	const [h, m] = String(job.schedule.time).split(":").map(Number);
	if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
	return { h, m: m ?? 0 };
}

function scheduleLabel(job: CronJob): string {
	if (job.schedule.kind === "every") {
		const minutes = Math.max(5, Math.floor(scheduleMinutes(job)));
		if (minutes % (60 * 24) === 0) return `every ${minutes / (60 * 24)}d`;
		if (minutes % 60 === 0) return `every ${minutes / 60}h`;
		return `every ${minutes}m`;
	}
	if (job.schedule.kind === "daily") return `daily ${job.schedule.time}`;
	if (job.schedule.kind === "weekly") {
		const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
		return `weekly ${job.schedule.days.map((day) => names[day] ?? String(day)).join(", ")} ${job.schedule.time}`;
	}
	if (job.schedule.kind === "event") return job.schedule.trigger === "turn_end" ? "on turn end" : "on commit";
	return "once";
}

/** Interval minutes for `every` schedules (matching the engine's floor). */
function scheduleMinutes(job: CronJob): number {
	if (job.schedule.kind !== "every") return 0;
	return job.schedule.minutes;
}

interface DayFires {
	/** Upcoming firings on this day (scheduled jobs only). */
	fires: { job: CronJob; at: number }[];
	/** Past runs on this day (any trigger). */
	runs: CronRun[];
}

export function CronCalendar({ jobs }: { jobs: CronJob[] }) {
	const runs = useCronStore((s) => s.runs);
	const refreshRuns = useCronStore((s) => s.refreshRuns);
	const [anchor, setAnchor] = useState(() => {
		const now = new Date();
		return new Date(now.getFullYear(), now.getMonth(), 1);
	});
	const [selected, setSelected] = useState<string>(() => dayKey(new Date()));

	useEffect(() => {
		void refreshRuns();
	}, [refreshRuns]);

	const jobIds = useMemo(() => new Set(jobs.map((job) => job.id)), [jobs]);

	/** Runs of this project's jobs (runs from deleted jobs drop out of scope). */
	const visibleRuns = useMemo(() => runs.filter((run) => jobIds.has(run.jobId)), [runs, jobIds]);

	const grid = useMemo(() => {
		const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
		const startOffset = first.getDay(); // Sunday-first grid
		const start = new Date(first);
		start.setDate(start.getDate() - startOffset);
		const weeks: Date[][] = [];
		for (let w = 0; w < 6; w++) {
			const week: Date[] = [];
			for (let d = 0; d < 7; d++) {
				const cell = new Date(start);
				cell.setDate(start.getDate() + w * 7 + d);
				week.push(cell);
			}
			weeks.push(week);
		}
		return weeks;
	}, [anchor]);

	const todayKey = dayKey(new Date());

	/** Everything happening per displayed day. */
	const byDay = useMemo(() => {
		const map = new Map<string, DayFires>();
		const touch = (key: string) => {
			let entry = map.get(key);
			if (!entry) {
				entry = { fires: [], runs: [] };
				map.set(key, entry);
			}
			return entry;
		};
		for (const week of grid) {
			for (const cell of week) {
				const key = dayKey(cell);
				const entry = touch(key);
				for (const job of jobs) {
					if (!job.enabled) continue;
					if (job.schedule.kind === "daily") {
						const t = scheduledTime(job);
						if (t) {
							entry.fires.push({
								job,
								at: new Date(cell.getFullYear(), cell.getMonth(), cell.getDate(), t.h, t.m).getTime(),
							});
						}
					} else if (job.schedule.kind === "weekly" && job.schedule.days.includes(cell.getDay())) {
						const t = scheduledTime(job);
						if (t) {
							entry.fires.push({
								job,
								at: new Date(cell.getFullYear(), cell.getMonth(), cell.getDate(), t.h, t.m).getTime(),
							});
						}
					} else if (job.schedule.kind === "once" && job.nextRunAt) {
						const next = new Date(job.nextRunAt);
						if (next.getFullYear() === cell.getFullYear() && next.getMonth() === cell.getMonth() && next.getDate() === cell.getDate()) {
							entry.fires.push({ job, at: job.nextRunAt });
						}
					}
				}
			}
		}
		for (const run of visibleRuns) {
			touch(dayKey(new Date(run.startedAt))).runs.push(run);
		}
		for (const entry of map.values()) {
			entry.fires.sort((a, b) => a.at - b.at);
			entry.runs.sort((a, b) => b.startedAt - a.startedAt);
		}
		return map;
	}, [grid, jobs, visibleRuns]);

	/** Interval and event jobs have no calendar day: strip under the grid. */
	const ongoing = jobs.filter((job) => job.enabled && (job.schedule.kind === "every" || job.schedule.kind === "event"));

	const entry = byDay.get(selected) ?? { fires: [], runs: [] };
	const selectedDate = useMemo(() => {
		const [y, m, d] = selected.split("-").map(Number);
		return new Date(y, (m ?? 1) - 1, d ?? 1);
	}, [selected]);

	const shiftMonth = (delta: number) => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + delta, 1));

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-4 pt-1">
			<div className="flex items-center justify-between">
				<div className="text-xs font-semibold text-pi-text">
					{anchor.toLocaleDateString([], { month: "long", year: "numeric" })}
				</div>
				<div className="flex items-center gap-0.5">
					<Button
						variant="ghost"
						size="icon-sm"
						icon={ChevronLeft}
						aria-label="Previous month"
						onClick={() => shiftMonth(-1)}
					/>
					<Button
						variant="ghost"
						size="sm"
						className="text-2xs"
						aria-label="Jump to today"
						onClick={() => {
							const now = new Date();
							setAnchor(new Date(now.getFullYear(), now.getMonth(), 1));
							setSelected(dayKey(now));
						}}
					>
						today
					</Button>
					<Button
						variant="ghost"
						size="icon-sm"
						icon={ChevronRight}
						aria-label="Next month"
						onClick={() => shiftMonth(1)}
					/>
				</div>
			</div>

			<div className="grid grid-cols-7 gap-px text-center text-2xs text-pi-text-faint">
				{["S", "M", "T", "W", "T", "F", "S"].map((label, i) => (
					<span key={i} className="py-0.5">
						{label}
					</span>
				))}
			</div>
			<div className="grid grid-cols-7 gap-px">
				{grid.flat().map((cell) => {
					const key = dayKey(cell);
					const dayData = byDay.get(key) ?? { fires: [], runs: [] };
					const inMonth = cell.getMonth() === anchor.getMonth();
					const isToday = key === todayKey;
					const isSelected = key === selected;
					const dayRuns = dayData.runs;
					const over = dayRuns.length > 3;
					const dayDots = dayRuns
						.slice(0, 3)
						.map((run, i) => (i === 2 && over ? "bg-pi-text-faint" : RUN_DOT[run.status]));
					return (
						<button
							type="button"
							key={key}
							onClick={() => setSelected(key)}
							aria-label={`${cell.toLocaleDateString()} — ${dayData.fires.length} scheduled, ${dayRuns.length} runs`}
							aria-pressed={isSelected}
							className={`flex h-9 flex-col items-center justify-start rounded pt-0.5 text-2xs transition-colors ${
								isSelected ? "bg-pi-accent/15 ring-1 ring-pi-accent/40" : "hover:bg-pi-surface-raised"
							} ${inMonth ? "text-pi-text" : "text-pi-text-faint/60"}`}
						>
							<span
								className={`flex h-4 w-4 items-center justify-center rounded-full ${
									isToday ? "bg-pi-accent font-semibold text-pi-text" : ""
								}`}
							>
								{cell.getDate()}
							</span>
							{dayData.fires.length > 0 && <Zap className="mt-0.5 h-2 w-2 text-pi-accent/80" />}
							{dayDots.length > 0 && (
								<span className="mt-0.5 flex gap-0.5">
									{dayDots.slice(0, 3).map((dot, i) => (
										<span key={i} className={`h-1.5 w-1.5 rounded-full ${dot}`} />
									))}
								</span>
							)}
						</button>
					);
				})}
			</div>

			{ongoing.length > 0 && (
				<div className="rounded-md border border-pi-border px-2 py-1.5">
					<div className="mb-1 text-2xs font-medium text-pi-text-muted">Ongoing (no fixed day)</div>
					{ongoing.map((job) => (
						<div key={job.id} className="flex items-center gap-1.5 py-0.5 text-2xs">
							<Hourglass className="h-2.5 w-2.5 shrink-0 text-pi-text-faint" />
							<span className="min-w-0 flex-1 truncate text-pi-text">{job.name}</span>
							<span className="shrink-0 text-pi-text-faint">{scheduleLabel(job)}</span>
						</div>
					))}
				</div>
			)}

			<div className="rounded-md border border-pi-border px-2 py-1.5">
				<div className="mb-1 flex items-baseline justify-between">
					<span className="text-2xs font-medium text-pi-text-muted">
						{selectedDate.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}
					</span>
					<span className="text-2xs text-pi-text-faint">
						{entry.fires.length + entry.runs.length === 0 ? "nothing scheduled" : `${entry.fires.length + entry.runs.length} item${entry.fires.length + entry.runs.length === 1 ? "" : "s"}`}
					</span>
				</div>
				{entry.fires.map((fire) => (
					<div key={`${fire.job.id}-${fire.at}`} className="flex items-center gap-1.5 py-0.5 text-2xs">
						<Zap className="h-2.5 w-2.5 shrink-0 text-pi-accent/80" />
						<span className="w-12 shrink-0 text-pi-text-muted">{timeOfDay(fire.at)}</span>
						<span className="min-w-0 flex-1 truncate text-pi-text">{fire.job.name}</span>
						<span className="shrink-0 text-pi-text-faint">{scheduleLabel(fire.job)}</span>
					</div>
				))}
				{entry.runs.slice(0, 30).map((run) => (
					<div key={run.id} className="flex items-center gap-1.5 py-0.5 text-2xs">
						<span className={`h-1.5 w-1.5 shrink-0 rounded-full ${RUN_DOT[run.status]} ${run.status === "running" ? "animate-pulse" : ""}`} />
						<span className="w-12 shrink-0 text-pi-text-muted">{timeOfDay(run.startedAt)}</span>
						<span
							className="min-w-0 flex-1 truncate text-pi-text"
							title={`ran ${scheduleTriggerLabel(run.trigger)} · ${run.delivery === "session" ? "session" : "background"}${run.error ? ` · ${run.error}` : ""}`}
						>
							{run.jobName}
							{run.status === "error" && <span className="text-pi-error"> · failed</span>}
							{run.status === "timeout" && <span className="text-pi-warning"> · timeout</span>}
							{run.triage && triageLabel(run) !== "quiet" && (
								<span className="text-pi-text-faint"> · {triageLabel(run)}</span>
							)}
						</span>
						{run.sessionFile && run.status !== "running" && (
							<Button
								variant="ghost"
								size="icon-sm"
								className="shrink-0"
								aria-label={`Continue ${run.jobName} run`}
								title="Continue this run's session"
								onClick={() => void openSessionFile(run.sessionFile!)}
							>
								<History className="h-2.5 w-2.5" />
							</Button>
						)}
					</div>
				))}
				{entry.runs.length > 30 && (
					<div className="py-0.5 text-2xs text-pi-text-faint">…and {entry.runs.length - 30} more runs</div>
				)}
			</div>
		</div>
	);
}

const RUN_DOT: Record<CronRun["status"], string> = {
	running: "bg-pi-accent",
	ok: "bg-pi-success",
	error: "bg-pi-error",
	timeout: "bg-pi-warning",
};

function triageLabel(run: CronRun): string | undefined {
	const triage = run.triage;
	if (!triage) return undefined;
	if (triage.outcome === "unavailable") return "triage unavailable";
	if (triage.recommendedAction === "notify") return "needs attention";
	if (triage.recommendedAction === "quiet") return "quiet";
	return `${triage.recommendedAction} suggested`;
}

function scheduleTriggerLabel(trigger: CronRun["trigger"]): string {
	return trigger === "manual" ? "manually" : trigger === "event" ? "by event" : "on schedule";
}