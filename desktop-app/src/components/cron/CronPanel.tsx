/**
 * Cron panel — the right-sidebar surface for scheduled tasks. Jobs are
 * project-scoped: this panel shows the active project's tasks (other
 * projects' jobs stay hidden), with run-now, pause/resume, edit, and delete.
 */

import { useEffect, useState } from "react";
import { Bot, CalendarDays, ChevronDown, ChevronRight, History, List, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "../ui/Button";
import { Switch } from "../ui/Switch";
import { cronDelete, cronRunNow, cronRuns, cronUpdate, type CronJob, type CronRun } from "../../lib/rpc";
import { useCronStore } from "../../stores/cron-store";
import { useSessionStore } from "../../stores/session-store";
import { openSessionFile } from "../../lib/open-session";
import { CronCalendar } from "./CronCalendar";
import { CronDetail } from "./CronDetail";
import { CronEditor } from "./CronEditor";
import { CronRunDialog } from "./CronRunDialog";

function relativeTime(ms: number | undefined): string {
	if (!ms) return "";
	const delta = Date.now() - ms;
	if (delta < 60_000) return "just now";
	if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
	if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
	return `${Math.floor(delta / 86_400_000)}d ago`;
}

function scheduleLabel(schedule: CronJob["schedule"]): string {
	if (schedule.kind === "every") {
		const minutes = Math.max(5, Math.floor(schedule.minutes));
		if (minutes % (60 * 24) === 0) return `every ${minutes / (60 * 24)}d`;
		if (minutes % 60 === 0) return `every ${minutes / 60}h`;
		return `every ${minutes}m`;
	}
	if (schedule.kind === "daily") return `daily ${schedule.time}`;
	if (schedule.kind === "weekly") {
		const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
		return `weekly ${schedule.days.map((day) => names[day] ?? String(day)).join(", ")} ${schedule.time}`;
	}
	if (schedule.kind === "event") return schedule.trigger === "turn_end" ? "on turn end" : "on commit";
	return "once";
}

export function CronPanel() {
	const jobs = useCronStore((s) => s.jobs);
	const error = useCronStore((s) => s.error);
	const refresh = useCronStore((s) => s.refresh);
	const cwd = useSessionStore((s) => s.cwd);
	const [editor, setEditor] = useState<{ open: boolean; job?: CronJob }>({ open: false });
	const [detail, setDetail] = useState<CronJob | null>(null);
	const [view, setView] = useState<"list" | "calendar">("list");

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const visible = jobs.filter((job) => job.cwd === cwd);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex items-center justify-between border-b border-pi-border px-3 py-2">
				<span className="text-xs font-semibold text-pi-text">Scheduled tasks</span>
				<div className="flex items-center gap-0.5">
					<Button
						variant="ghost"
						size="icon-sm"
						icon={view === "list" ? CalendarDays : List}
						aria-label={view === "list" ? "Switch to calendar view" : "Switch to list view"}
						title={view === "list" ? "Calendar view" : "List view"}
						onClick={() => setView(view === "list" ? "calendar" : "list")}
					/>
					<Button
						variant="ghost"
						size="icon-sm"
						icon={Plus}
						aria-label="New scheduled task"
						onClick={() => setEditor({ open: true })}
					/>
				</div>
			</div>

			{error && (
				<div className="px-3 py-2 text-2xs text-pi-error">
					{error}{" "}
					<button type="button" className="underline" onClick={() => void refresh()}>
						retry
					</button>
				</div>
			)}

			{view === "calendar" ? (
				<CronCalendar jobs={visible} />
			) : (
				<div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
					{visible.length === 0 && (
						<div className="px-1.5 py-2 text-2xs leading-relaxed text-pi-text-faint">
							{jobs.length === 0
								? "No scheduled tasks yet. Schedule standing work — the agent runs it in this project and reports in the conversation."
								: "No scheduled tasks for this project."}
						</div>
					)}
					{visible.map((job) => (
						<CronRow
							key={job.id}
							job={job}
							onOpen={() => setDetail(job)}
							onEdit={() => setEditor({ open: true, job })}
						/>
					))}
				</div>
			)}

			{editor.open && <CronEditor job={editor.job} onClose={() => setEditor({ open: false })} />}
			{detail && (
				<CronDetail
					job={detail}
					onClose={() => setDetail(null)}
					onEdit={(job) => {
						setDetail(null);
						setEditor({ open: true, job });
					}}
				/>
			)}
		</div>
	);
}

function CronRow({ job, onOpen, onEdit }: { job: CronJob; onOpen: () => void; onEdit: () => void }) {
	const [busy, setBusy] = useState(false);
	const [expanded, setExpanded] = useState(false);
	const [runDialog, setRunDialog] = useState(false);
	const [runs, setRuns] = useState<CronRun[] | null>(null);
	const [runsLoading, setRunsLoading] = useState(false);

	const toggleRuns = () => {
		const next = !expanded;
		setExpanded(next);
		if (next && runs === null) {
			setRunsLoading(true);
			void cronRuns(job.id)
				.then((result) => setRuns(result.runs))
				.catch(() => setRuns([]))
				.finally(() => setRunsLoading(false));
		}
	};

	const runNow = async () => {
		if (busy) return;
		if ((job.variables ?? []).length > 0) {
			setRunDialog(true);
			return;
		}
		setBusy(true);
		try {
			await cronRunNow(job.id);
		} finally {
			setBusy(false);
		}
	};

	const toggle = async (next: boolean) => {
		if (busy) return;
		setBusy(true);
		try {
			await cronUpdate(job.id, { enabled: next });
		} finally {
			setBusy(false);
		}
	};

	const remove = async () => {
		if (busy) return;
		setBusy(true);
		try {
			await cronDelete(job.id);
		} finally {
			setBusy(false);
		}
	};

	const nextRun = job.enabled && job.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : undefined;
	const failed = job.lastStatus === "error" || job.lastStatus === "timeout";
	const isEvent = job.schedule.kind === "event";
	const lastTriage = triageLabel(job.lastTriage);

	return (
		<div className="flex w-full flex-col rounded-md transition-hover hover:bg-pi-surface-raised">
			<div className="group flex w-full items-start gap-2 px-1.5 py-1.5">
				<button
					type="button"
					className="mt-1 flex h-4 w-4 shrink-0 items-center justify-center rounded text-pi-text-faint hover:bg-pi-surface hover:text-pi-text"
					aria-label={expanded ? `Hide run history for ${job.name}` : `Show run history for ${job.name}`}
					aria-expanded={expanded}
					onClick={toggleRuns}
				>
					{expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
				</button>
				<div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
					<div className="flex items-center gap-1.5 text-xs font-medium text-pi-text">
						<button type="button" className="truncate text-left hover:underline" onClick={onOpen}>
							{job.name}
						</button>
						{!job.enabled && <span className="shrink-0 text-2xs text-pi-text-faint">(paused)</span>}
						{failed && (
							<span
								className="h-1.5 w-1.5 shrink-0 rounded-full bg-pi-error"
								title={job.lastError ?? "Last run failed"}
							/>
						)}
					</div>
					<div className="truncate text-2xs text-pi-text-muted">
						{scheduleLabel(job.schedule)}
						{nextRun ? ` · next ${nextRun}` : isEvent ? " · awaiting event" : ""}
						{job.lastRunAt ? ` · last ${relativeTime(job.lastRunAt)}` : ""}
						{lastTriage ? ` · ${lastTriage}` : ""}
						{failed ? ` · ${job.lastError?.slice(0, 60) ?? "failed"}` : ""}
					</div>
					<div className="mt-0.5 line-clamp-2 text-2xs leading-relaxed text-pi-text-faint">{job.prompt}</div>
				</div>
				<div className="flex shrink-0 items-center gap-0.5">
					<Button
						variant="ghost"
						size="icon-sm"
						icon={busy ? Loader2 : Bot}
						aria-label="Run now"
						disabled={busy}
						onClick={() => void runNow()}
					/>
					<Button variant="ghost" size="icon-sm" icon={Pencil} aria-label={`Edit ${job.name}`} onClick={onEdit} />
					<Button
						variant="ghost"
						size="icon-sm"
						icon={Trash2}
						aria-label={`Delete ${job.name}`}
						disabled={busy}
						onClick={() => void remove()}
					/>
					<Switch
						checked={job.enabled}
						onChange={() => void toggle(!job.enabled)}
						ariaLabel={job.enabled ? `Pause ${job.name}` : `Resume ${job.name}`}
						size="sm"
					/>
				</div>
			</div>
			{expanded && <RunHistory runs={runs} loading={runsLoading} />}
			{runDialog && <CronRunDialog job={job} onClose={() => setRunDialog(false)} />}
		</div>
	);
}

function triageLabel(triage: CronRun["triage"]): string | undefined {
	if (!triage) return undefined;
	if (triage.outcome === "unavailable") return "triage unavailable";
	if (triage.recommendedAction === "notify") return "needs attention";
	if (triage.recommendedAction === "quiet") return "quiet";
	return `${triage.recommendedAction} suggested`;
}

const TRIAGE_CLASS: Record<string, string> = {
	"needs attention": "text-pi-accent",
	quiet: "text-pi-text-faint",
	"retry suggested": "text-pi-warning",
	"pause suggested": "text-pi-error",
	"triage unavailable": "text-pi-text-faint",
};

const RUN_STATUS_DOT: Record<CronRun["status"], string> = {
	running: "bg-pi-accent animate-pulse",
	ok: "bg-pi-success",
	error: "bg-pi-error",
	timeout: "bg-pi-warning",
};

function RunHistory({ runs, loading }: { runs: CronRun[] | null; loading: boolean }) {
	if (loading || runs === null) {
		return (
			<div className="flex items-center gap-1.5 px-6 pb-2 text-2xs text-pi-text-faint">
				<Loader2 className="h-3 w-3 animate-spin" /> loading runs…
			</div>
		);
	}
	if (runs.length === 0) {
		return <div className="px-6 pb-2 text-2xs text-pi-text-faint">No runs yet.</div>;
	}
	return (
		<div className="mb-1.5 ml-6 mr-1.5 flex flex-col gap-0.5 border-l border-pi-border pl-2">
			{runs.map((run) => (
				<div key={run.id} className="flex items-center gap-1.5 rounded px-1 py-0.5 hover:bg-pi-surface-raised">
					<span className={`h-1.5 w-1.5 shrink-0 rounded-full ${RUN_STATUS_DOT[run.status]}`} />
					<span className="w-16 shrink-0 text-2xs text-pi-text-muted">{relativeTime(run.startedAt)}</span>
					<span className="shrink-0 text-2xs text-pi-text-faint">
						{run.trigger === "manual" ? "manual" : "schedule"} · {run.delivery === "session" ? "session" : "background"}
					</span>
					{(() => {
						const label = triageLabel(run.triage);
						return label ? (
							<span
								className={`shrink-0 text-2xs ${TRIAGE_CLASS[label] ?? "text-pi-text-faint"}`}
								title={run.triage?.error ?? run.summary}
							>
								· {label}
							</span>
						) : null;
					})()}
					{run.error && (
						<span className="min-w-0 flex-1 truncate text-2xs text-pi-error" title={run.error}>
							{run.error}
						</span>
					)}
					{run.sessionFile && run.status !== "running" && (
						<Button
							variant="ghost"
							size="sm"
							className="ml-auto shrink-0 text-2xs text-pi-text-muted"
							aria-label="Continue run"
							onClick={() => void openSessionFile(run.sessionFile!)}
						>
							<History className="h-3 w-3" />
							Continue
						</Button>
					)}
				</div>
			))}
		</div>
	);
}
