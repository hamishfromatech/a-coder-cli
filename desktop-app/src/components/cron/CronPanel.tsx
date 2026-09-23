/**
 * Cron panel — the right-sidebar surface for scheduled tasks. Jobs are
 * project-scoped: this panel shows the active project's tasks (other
 * projects' jobs stay hidden), with run-now, pause/resume, edit, and delete.
 */

import { useEffect, useState } from "react";
import { Bot, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "../ui/Button";
import { Switch } from "../ui/Switch";
import { cronDelete, cronRunNow, cronUpdate, type CronJob } from "../../lib/rpc";
import { useCronStore } from "../../stores/cron-store";
import { useSessionStore } from "../../stores/session-store";
import { CronEditor } from "./CronEditor";

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
	return "once";
}

export function CronPanel() {
	const jobs = useCronStore((s) => s.jobs);
	const error = useCronStore((s) => s.error);
	const refresh = useCronStore((s) => s.refresh);
	const cwd = useSessionStore((s) => s.cwd);
	const [editor, setEditor] = useState<{ open: boolean; job?: CronJob }>({ open: false });

	useEffect(() => {
		void refresh();
	}, [refresh]);

	const visible = jobs.filter((job) => job.cwd === cwd);

	return (
		<div className="flex h-full min-h-0 flex-col">
			<div className="flex items-center justify-between border-b border-pi-border px-3 py-2">
				<span className="text-xs font-semibold text-pi-text">Scheduled tasks</span>
				<Button
					variant="ghost"
					size="icon-sm"
					icon={Plus}
					aria-label="New scheduled task"
					onClick={() => setEditor({ open: true })}
				/>
			</div>

			{error && (
				<div className="px-3 py-2 text-2xs text-pi-error">
					{error}{" "}
					<button type="button" className="underline" onClick={() => void refresh()}>
						retry
					</button>
				</div>
			)}

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
						onEdit={() => setEditor({ open: true, job })}
					/>
				))}
			</div>

			{editor.open && <CronEditor job={editor.job} onClose={() => setEditor({ open: false })} />}
		</div>
	);
}

function CronRow({ job, onEdit }: { job: CronJob; onEdit: () => void }) {
	const [busy, setBusy] = useState(false);

	const runNow = async () => {
		if (busy) return;
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

	return (
		<div className="group flex w-full items-start gap-2 rounded-md px-1.5 py-1.5 transition-hover hover:bg-pi-surface-raised">
			<div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
				<div className="flex items-center gap-1.5 text-xs font-medium text-pi-text">
					<span className="truncate">{job.name}</span>
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
					{nextRun ? ` · next ${nextRun}` : ""}
					{job.lastRunAt ? ` · last ${relativeTime(job.lastRunAt)}` : ""}
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
	);
}
