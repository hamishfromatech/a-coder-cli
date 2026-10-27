/**
 * Scheduled-task run history: one row per execution, with exact local times,
 * duration, execution mode, model, outcome, summary/error and handles.
 *
 * Shared by the routine detail (one job) and the panel's machine-wide Runs
 * view. Rows open a detail dialog with the full record (variables, triage,
 * session/log/worktree paths).
 */

import { open as openPath } from "@tauri-apps/plugin-shell";
import { Copy, FileText, History, X } from "lucide-react";
import { openSessionFile } from "../../lib/open-session";
import type { CronRun } from "../../lib/rpc";
import { Button } from "../ui/Button";
import { ModalBackdrop, ModalPanel } from "../ui/Modal";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const two = (value: number) => String(value).padStart(2, "0");

/** `Oct 26, 14:05:22` — the year is included when it is not the current one. */
export function absoluteTime(ms: number | undefined, seconds = true): string {
	if (!ms) return "—";
	const date = new Date(ms);
	const year = date.getFullYear() === new Date().getFullYear() ? "" : `, ${date.getFullYear()}`;
	const time = `${two(date.getHours())}:${two(date.getMinutes())}${seconds ? `:${two(date.getSeconds())}` : ""}`;
	return `${MONTHS[date.getMonth()]} ${date.getDate()}${year}, ${time}`;
}

export function relativeTime(ms: number | undefined): string {
	if (!ms) return "";
	const delta = Date.now() - ms;
	if (delta < 60_000) return "just now";
	if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
	if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
	return `${Math.floor(delta / 86_400_000)}d ago`;
}

export function runDuration(run: CronRun): string {
	if (!run.finishedAt || run.status === "running") return "running";
	const ms = run.finishedAt - run.startedAt;
	if (ms < 0) return "—";
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
	return `${Math.floor(ms / 60_000)}m ${Math.floor((ms % 60_000) / 1000)}s`;
}

export function statusClass(status: CronRun["status"]): string {
	if (status === "ok") return "text-pi-success";
	if (status === "error") return "text-pi-error";
	if (status === "timeout") return "text-pi-warning";
	return "text-pi-accent";
}

export function triageLabel(triage: CronRun["triage"]): string | undefined {
	if (!triage) return undefined;
	if (triage.outcome === "unavailable") return "triage unavailable";
	if (triage.recommendedAction === "notify") return "needs attention";
	if (triage.recommendedAction === "quiet") return "quiet";
	return `${triage.recommendedAction} suggested`;
}

export function dayLabel(ms: number): string {
	const date = new Date(ms);
	const now = new Date();
	const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
	const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
	const delta = Math.round((today.getTime() - day.getTime()) / 86_400_000);
	if (delta <= 0) return "Today";
	if (delta === 1) return "Yesterday";
	const year = date.getFullYear() === now.getFullYear() ? "" : `, ${date.getFullYear()}`;
	return `${MONTHS[date.getMonth()]} ${date.getDate()}${year}`;
}

export function groupRunsByDay(runs: CronRun[]): Array<{ label: string; runs: CronRun[] }> {
	const groups: Array<{ label: string; runs: CronRun[] }> = [];
	for (const run of runs) {
		const label = dayLabel(run.startedAt);
		const last = groups[groups.length - 1];
		if (last?.label === label) {
			last.runs.push(run);
		} else {
			groups.push({ label, runs: [run] });
		}
	}
	return groups;
}

export function CronRunRow({
	run,
	showJobName = false,
	onOpen,
}: {
	run: CronRun;
	showJobName?: boolean;
	onOpen: () => void;
}) {
	const triage = triageLabel(run.triage);
	const meta = [run.trigger, run.execution ?? "session", run.delivery, runDuration(run)].join(" · ");
	return (
		<div
			role="button"
			tabIndex={0}
			onClick={onOpen}
			onKeyDown={(event) => {
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onOpen();
				}
			}}
			className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 transition-hover hover:bg-pi-surface-raised focus-visible:shadow-focus focus-visible:outline-none"
		>
			<span
				className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
					run.status === "ok"
						? "bg-pi-success"
						: run.status === "error"
							? "bg-pi-error"
							: run.status === "timeout"
								? "bg-pi-warning"
								: "bg-pi-accent animate-pulse"
				}`}
			/>
			<div className="min-w-0 flex-1">
				<div className="flex items-baseline gap-1.5">
					{showJobName && (
						<span className="truncate text-xs font-medium text-pi-text">{run.jobName || run.jobId}</span>
					)}
					<span className="font-mono text-2xs text-pi-text-secondary">{absoluteTime(run.startedAt)}</span>
					<span className="text-4xs text-pi-text-faint">{relativeTime(run.startedAt)}</span>
					<span className={`ml-auto shrink-0 font-mono text-3xs uppercase tracking-wide ${statusClass(run.status)}`}>
						{run.status}
					</span>
				</div>
				<div className="truncate font-mono text-3xs text-pi-text-faint">{meta}</div>
				{run.model && (
					<div className="truncate font-mono text-3xs text-pi-text-faint">
						{run.model}
						{run.modelSource ? ` (${run.modelSource})` : ""}
					</div>
				)}
				{run.summary && (
					<div className="mt-0.5 line-clamp-2 text-2xs leading-relaxed text-pi-text-muted">{run.summary}</div>
				)}
				{run.error && (
					<div className="mt-0.5 line-clamp-2 text-2xs leading-relaxed text-pi-error">{run.error}</div>
				)}
				{triage && <div className="mt-0.5 text-3xs text-pi-accent">{triage}</div>}
			</div>
			{run.outputFile && (
				<Button
					variant="ghost"
					size="icon-sm"
					icon={FileText}
					aria-label="Open subagent log"
					title="Open subagent log"
					onClick={(event) => {
						event.stopPropagation();
						void openPath(run.outputFile!).catch(() => {});
					}}
				/>
			)}
			{run.sessionFile && run.status !== "running" && (
				<Button
					variant="ghost"
					size="icon-sm"
					icon={History}
					aria-label="Continue run"
					title="Continue run"
					onClick={(event) => {
						event.stopPropagation();
						void openSessionFile(run.sessionFile!);
					}}
				/>
			)}
		</div>
	);
}

const STATUS_LABEL: Record<string, string> = {
	ok: "completed",
	error: "failed",
	timeout: "timed out",
	running: "running",
};

export function CronRunDetails({ run, onClose }: { run: CronRun; onClose: () => void }) {
	const triage = run.triage;
	const probability = (value: number | undefined) =>
		typeof value === "number" ? `${Math.round(value * 100)}%` : "—";

	const row = (label: string, value: string, mono = false) => (
		<div className="flex gap-3 py-0.5">
			<span className="w-32 shrink-0 text-2xs text-pi-text-muted">{label}</span>
			<span className={`min-w-0 flex-1 break-words text-2xs text-pi-text-secondary ${mono ? "font-mono" : ""}`}>
				{value}
			</span>
		</div>
	);

	const handle = (label: string, path: string) => (
		<div className="flex items-center gap-2 py-0.5">
			<span className="w-32 shrink-0 text-2xs text-pi-text-muted">{label}</span>
			<span className="min-w-0 flex-1 truncate font-mono text-3xs text-pi-text-secondary" title={path}>
				{path}
			</span>
			<Button
				variant="ghost"
				size="icon-sm"
				icon={Copy}
				aria-label="Copy path"
				title="Copy path"
				onClick={() => void navigator.clipboard.writeText(path).catch(() => {})}
			/>
		</div>
	);

	return (
		<ModalBackdrop onClick={onClose}>
			<ModalPanel className="w-full max-w-lg" onClick={(event) => event.stopPropagation()}>
				<div className="flex items-center gap-2 border-b border-pi-border px-4 py-3">
					<span className="min-w-0 flex-1 truncate text-sm font-semibold text-pi-text">
						{run.jobName || "Run"}
					</span>
					<span className={`font-mono text-3xs uppercase tracking-wide ${statusClass(run.status)}`}>
						{STATUS_LABEL[run.status] ?? run.status}
					</span>
					<Button variant="ghost" size="icon-sm" icon={X} aria-label="Close" onClick={onClose} />
				</div>
				<div className="max-h-[70vh] overflow-y-auto px-4 py-3">
					{row("Started", absoluteTime(run.startedAt))}
					{row("Finished", run.finishedAt ? absoluteTime(run.finishedAt) : "—")}
					{row("Duration", runDuration(run))}
					{row("Trigger", run.trigger)}
					{row("Execution", run.execution ?? "session")}
					{row("Delivery", run.delivery)}
					{run.model && row("Model", `${run.model}${run.modelSource ? ` (${run.modelSource})` : ""}`)}

					{run.variables && Object.keys(run.variables).length > 0 && (
						<>
							<div className="mt-3 text-3xs font-semibold uppercase tracking-wider text-pi-text-faint">Variables</div>
							{Object.entries(run.variables).map(([key, value]) => row(key, value, true))}
						</>
					)}

					{triage && (
						<>
							<div className="mt-3 text-3xs font-semibold uppercase tracking-wider text-pi-text-faint">Triage</div>
							{row("Outcome", triage.outcome)}
							{row("Recommended", triage.recommendedAction)}
							{row("Notify probability", probability(triage.notify))}
							{row("Retry probability", probability(triage.retry))}
							{row("Pause probability", probability(triage.pause))}
							{triage.error && row("Triage error", triage.error)}
						</>
					)}

					{run.summary && (
						<>
							<div className="mt-3 text-3xs font-semibold uppercase tracking-wider text-pi-text-faint">Summary</div>
							<p className="mt-1 whitespace-pre-wrap text-2xs leading-relaxed text-pi-text-secondary">{run.summary}</p>
						</>
					)}
					{run.error && (
						<>
							<div className="mt-3 text-3xs font-semibold uppercase tracking-wider text-pi-text-faint">Error</div>
							<p className="mt-1 whitespace-pre-wrap text-2xs leading-relaxed text-pi-error">{run.error}</p>
						</>
					)}

					{(run.sessionFile || run.outputFile || run.worktreePath || run.subagentId) && (
						<>
							<div className="mt-3 text-3xs font-semibold uppercase tracking-wider text-pi-text-faint">Handles</div>
							{run.sessionFile && handle("Session", run.sessionFile)}
							{run.outputFile && handle("Subagent log", run.outputFile)}
							{run.worktreePath && handle("Worktree", run.worktreePath)}
							{run.subagentId && row("Subagent", run.subagentId, true)}
						</>
					)}
				</div>
				<div className="flex justify-end gap-2 border-t border-pi-border px-4 py-3">
					{run.sessionFile && run.status !== "running" && (
						<Button
							variant="outline"
							size="sm"
							icon={History}
							onClick={() => void openSessionFile(run.sessionFile!)}
						>
							Open run session
						</Button>
					)}
					{run.outputFile && (
						<Button
							variant="secondary"
							size="sm"
							icon={FileText}
							onClick={() => void openPath(run.outputFile!).catch(() => {})}
						>
							Open log
						</Button>
					)}
					<Button variant="primary" size="sm" onClick={onClose}>
						Close
					</Button>
				</div>
			</ModalPanel>
		</ModalBackdrop>
	);
}
