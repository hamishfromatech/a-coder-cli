/**
 * Routine detail — a focused view over one scheduled task: configuration,
 * run history, a combined activity timeline, and restorable revision history.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
	Bot,
	CalendarClock,
	Check,
	History,
	Loader2,
	Pause,
	Pencil,
	Play,
	RotateCcw,
	X,
} from "lucide-react";
import {
	cronRevisions,
	cronRestoreRevision,
	cronRunNow,
	cronRuns,
	cronUpdate,
	type CronJob,
	type CronJobRevision,
	type CronRun,
} from "../../lib/rpc";
import { useCronStore } from "../../stores/cron-store";
import { useConfirmStore } from "../../stores/confirm-store";
import { openSessionFile } from "../../lib/open-session";
import { Button } from "../ui/Button";
import { ModalBackdrop, ModalPanel } from "../ui/Modal";
import { CronRunDialog } from "./CronRunDialog";

type DetailTab = "overview" | "runs" | "activity" | "history";

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

function relativeTime(ms: number | undefined): string {
	if (!ms) return "";
	const delta = Date.now() - ms;
	if (delta < 60_000) return "just now";
	if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
	if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
	return `${Math.floor(delta / 86_400_000)}d ago`;
}

function duration(run: CronRun): string {
	if (!run.finishedAt) return "running";
	const ms = run.finishedAt - run.startedAt;
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

function statusClass(status: CronRun["status"]): string {
	if (status === "ok") return "text-pi-success";
	if (status === "error") return "text-pi-error";
	if (status === "timeout") return "text-pi-warning";
	return "text-pi-accent";
}

function triageLabel(triage: CronRun["triage"]): string | undefined {
	if (!triage) return undefined;
	if (triage.outcome === "unavailable") return "triage unavailable";
	if (triage.recommendedAction === "notify") return "needs attention";
	if (triage.recommendedAction === "quiet") return "quiet";
	return `${triage.recommendedAction} suggested`;
}

export function CronDetail({
	job: initialJob,
	onClose,
	onEdit,
}: {
	job: CronJob;
	onClose: () => void;
	onEdit: (job: CronJob) => void;
}) {
	const [tab, setTab] = useState<DetailTab>("overview");
	const [job, setJob] = useState(initialJob);
	const [runs, setRuns] = useState<CronRun[]>([]);
	const [revisions, setRevisions] = useState<CronJobRevision[]>([]);
	const [loading, setLoading] = useState(true);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [runDialog, setRunDialog] = useState(false);
	const refreshStore = useCronStore((state) => state.refresh);
	const confirm = useConfirmStore((state) => state.ask);

	const load = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [runResult, revisionResult] = await Promise.all([cronRuns(job.id), cronRevisions(job.id)]);
			setRuns(runResult.runs);
			setRevisions(revisionResult.revisions);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setLoading(false);
		}
	}, [job.id]);

	useEffect(() => {
		void load();
	}, [load]);

	const runNow = async () => {
		if ((job.variables ?? []).length > 0) {
			setRunDialog(true);
			return;
		}
		setBusy(true);
		setError(null);
		try {
			await cronRunNow(job.id);
			await refreshStore();
			await load();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setBusy(false);
		}
	};

	const toggleEnabled = async () => {
		setBusy(true);
		setError(null);
		try {
			const result = await cronUpdate(job.id, { enabled: !job.enabled });
			setJob(result.job);
			await refreshStore();
			await load();
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setBusy(false);
		}
	};

	const restore = async (revision: CronJobRevision) => {
		const confirmed = await confirm({
			title: `Restore “${job.name}” to v${revision.revision}?`,
			message: "This replaces the current configuration and creates a new revision. Run history is kept.",
			confirmLabel: "Restore",
		});
		if (!confirmed) return;
		setBusy(true);
		setError(null);
		try {
			const result = await cronRestoreRevision(job.id, revision.id);
			setJob(result.job);
			await refreshStore();
			await load();
			setTab("overview");
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
		} finally {
			setBusy(false);
		}
	};

	const activity = useMemo(() => {
		const items = [
			...revisions.map((revision) => ({
				id: `revision:${revision.id}`,
				at: revision.createdAt,
				title: `Configuration v${revision.revision} ${revision.reason}`,
				detail: `${revision.config.name} · ${scheduleLabel(revision.config.schedule)}`,
				kind: "revision" as const,
			})),
			...runs.map((run) => ({
				id: `run:${run.id}`,
				at: run.finishedAt ?? run.startedAt,
				title: `Run ${run.status}`,
				detail: `${run.trigger} · ${run.delivery} · ${duration(run)}${run.triage ? ` · ${triageLabel(run.triage)}` : ""}`,
				kind: "run" as const,
			})),
		];
		return items.sort((a, b) => b.at - a.at);
	}, [revisions, runs]);

	return (
		<>
			<ModalBackdrop onClick={onClose}>
				<ModalPanel className="w-full max-w-2xl" onClick={(event) => event.stopPropagation()}>
					<div className="flex items-start justify-between gap-3 border-b border-pi-border px-4 py-3">
						<div className="min-w-0">
							<div className="flex items-center gap-2">
								<span className="truncate text-sm font-semibold text-pi-text">{job.name}</span>
								{job.revision !== undefined && (
									<span className="shrink-0 rounded-full bg-pi-surface-raised px-1.5 py-0.5 text-2xs text-pi-text-faint">
										v{job.revision}
									</span>
								)}
								{!job.enabled && <span className="shrink-0 text-2xs text-pi-text-faint">paused</span>}
							</div>
							<div className="mt-0.5 text-2xs text-pi-text-muted">
								{scheduleLabel(job.schedule)} · {job.enabled ? `next ${job.nextRunAt ? new Date(job.nextRunAt).toLocaleString() : "awaiting event"}` : "paused"}
							</div>
						</div>
						<div className="flex shrink-0 items-center gap-1">
							<Button variant="ghost" size="icon-sm" icon={Pencil} aria-label="Edit routine" onClick={() => onEdit(job)} />
							<Button
								variant="ghost"
								size="icon-sm"
								icon={job.enabled ? Pause : Play}
								aria-label={job.enabled ? "Pause routine" : "Resume routine"}
								disabled={busy}
								onClick={() => void toggleEnabled()}
							/>
							<Button variant="primary" size="sm" icon={Bot} loading={busy} onClick={() => void runNow()}>
								Run now
							</Button>
							<Button variant="ghost" size="icon-sm" icon={X} aria-label="Close routine" onClick={onClose} />
						</div>
					</div>

					<div className="flex items-center gap-1 border-b border-pi-border px-3 py-1.5">
						{(["overview", "runs", "activity", "history"] as const).map((value) => (
							<Button
								key={value}
								variant={tab === value ? "secondary" : "ghost"}
								size="sm"
								onClick={() => setTab(value)}
							>
								{value === "overview" ? "Overview" : value === "runs" ? `Runs${runs.length ? ` ${runs.length}` : ""}` : value === "activity" ? "Activity" : `History${revisions.length ? ` ${revisions.length}` : ""}`}
							</Button>
						))}
						{loading && <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-pi-text-faint" />}
					</div>

					<div className="max-h-[60vh] overflow-y-auto px-4 py-3">
						{error && <div className="mb-2 rounded-md bg-pi-error/10 px-2.5 py-2 text-2xs text-pi-error">{error}</div>}

						{tab === "overview" && (
							<div className="space-y-3">
								<div className="grid gap-2 sm:grid-cols-2">
									<Property label="Schedule" value={scheduleLabel(job.schedule)} />
									<Property label="Project" value={job.cwd} mono />
									<Property label="Overlap" value={job.concurrencyPolicy ?? "coalesce_if_active"} />
									<Property label="Missed windows" value={job.catchUpPolicy ?? "run_once"} />
									<Property label="Last run" value={job.lastRunAt ? `${relativeTime(job.lastRunAt)}${job.lastStatus ? ` · ${job.lastStatus}` : ""}` : "never"} />
									<Property label="Last triage" value={triageLabel(job.lastTriage) ?? "none"} />
								</div>
								{(job.variables ?? []).length > 0 && (
									<div>
										<div className="mb-1 text-2xs font-medium uppercase tracking-wide text-pi-text-faint">Inputs</div>
										<div className="flex flex-wrap gap-1.5">
											{(job.variables ?? []).map((variable) => (
												<span key={variable.name} className="rounded-full bg-pi-surface-raised px-2 py-0.5 font-mono text-2xs text-pi-text-muted">
													{variable.name}={variable.value || "—"}
												</span>
											))}
										</div>
									</div>
								)}
								<div>
									<div className="mb-1 text-2xs font-medium uppercase tracking-wide text-pi-text-faint">Task</div>
									<pre className="whitespace-pre-wrap rounded-md bg-pi-surface-raised px-2.5 py-2 text-2xs leading-relaxed text-pi-text">{job.prompt}</pre>
								</div>
								{job.lastTriage?.outcome === "unavailable" && job.lastTriage.error && (
									<div className="text-2xs text-pi-text-faint">Triage: {job.lastTriage.error}</div>
								)}
							</div>
						)}

						{tab === "runs" && <RunList runs={runs} loading={loading} />}
						{tab === "activity" && (
							<div className="space-y-1">
								{activity.length === 0 ? (
									<div className="py-6 text-center text-2xs text-pi-text-faint">No activity yet.</div>
								) : (
									activity.map((item) => (
										<div key={item.id} className="flex items-start gap-2 rounded-md px-1.5 py-1.5 hover:bg-pi-surface-raised">
											{item.kind === "revision" ? (
												<History className="mt-0.5 h-3 w-3 shrink-0 text-pi-text-faint" />
											) : (
												<CalendarClock className="mt-0.5 h-3 w-3 shrink-0 text-pi-text-faint" />
											)}
											<div className="min-w-0 flex-1">
												<div className="text-xs text-pi-text">{item.title}</div>
												<div className="truncate text-2xs text-pi-text-muted">{item.detail}</div>
											</div>
											<span className="shrink-0 text-2xs text-pi-text-faint">{relativeTime(item.at)}</span>
										</div>
									))
								)}
							</div>
						)}
						{tab === "history" && (
							<div className="space-y-1">
								{revisions.length === 0 ? (
									<div className="py-6 text-center text-2xs text-pi-text-faint">No saved revisions yet.</div>
								) : (
									revisions.map((revision) => (
										<div key={revision.id} className="flex items-start gap-2 rounded-md px-1.5 py-1.5 hover:bg-pi-surface-raised">
											<div className="min-w-0 flex-1">
												<div className="flex items-center gap-1.5 text-xs text-pi-text">
													v{revision.revision}
													<span className="text-2xs text-pi-text-faint">{revision.reason}</span>
													{revision.revision === job.revision && <Check className="h-3 w-3 text-pi-success" />}
												</div>
												<div className="truncate text-2xs text-pi-text-muted">
													{revision.config.name} · {scheduleLabel(revision.config.schedule)}
												</div>
												<div className="text-2xs text-pi-text-faint">{new Date(revision.createdAt).toLocaleString()}</div>
											</div>
											<Button
												variant="ghost"
												size="sm"
												icon={RotateCcw}
												disabled={busy || revision.revision === job.revision}
												onClick={() => void restore(revision)}
											>
												Restore
											</Button>
										</div>
									))
								)}
							</div>
						)}
					</div>
				</ModalPanel>
			</ModalBackdrop>
			{runDialog && (
				<CronRunDialog
					job={job}
					onClose={() => setRunDialog(false)}
					onRan={() => {
						void refreshStore();
						void load();
					}}
				/>
			)}
		</>
	);
}

function Property({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
	return (
		<div className="rounded-md border border-pi-border/70 px-2.5 py-1.5">
			<div className="text-2xs text-pi-text-faint">{label}</div>
			<div className={`mt-0.5 truncate text-xs text-pi-text ${mono ? "font-mono" : ""}`} title={value}>
				{value}
			</div>
		</div>
	);
}

function RunList({ runs, loading }: { runs: CronRun[]; loading: boolean }) {
	if (loading) return <div className="py-6 text-center text-2xs text-pi-text-faint">Loading runs…</div>;
	if (runs.length === 0) return <div className="py-6 text-center text-2xs text-pi-text-faint">No runs yet.</div>;
	return (
		<div className="space-y-1">
			{runs.map((run) => (
				<div key={run.id} className="flex items-start gap-2 rounded-md px-1.5 py-1.5 hover:bg-pi-surface-raised">
					<span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${run.status === "ok" ? "bg-pi-success" : run.status === "error" ? "bg-pi-error" : run.status === "timeout" ? "bg-pi-warning" : "bg-pi-accent animate-pulse"}`} />
					<div className="min-w-0 flex-1">
						<div className="flex flex-wrap items-center gap-1.5 text-xs text-pi-text">
							<span className={statusClass(run.status)}>{run.status}</span>
							<span className="text-2xs text-pi-text-faint">{run.trigger} · {run.delivery} · {duration(run)}</span>
							{triageLabel(run.triage) && <span className="text-2xs text-pi-accent">{triageLabel(run.triage)}</span>}
						</div>
						{run.summary && <div className="mt-0.5 line-clamp-2 text-2xs leading-relaxed text-pi-text-muted">{run.summary}</div>}
						{run.error && <div className="mt-0.5 truncate text-2xs text-pi-error">{run.error}</div>}
					</div>
					<span className="shrink-0 text-2xs text-pi-text-faint">{relativeTime(run.startedAt)}</span>
					{run.sessionFile && run.status !== "running" && (
						<Button variant="ghost" size="icon-sm" icon={History} aria-label="Continue run" onClick={() => void openSessionFile(run.sessionFile!)} />
					)}
				</div>
			))}
		</div>
	);
}
