import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, ChevronDown, ChevronRight, Loader2, Sparkles, Terminal, X } from "lucide-react";
import { useModalA11y } from "../hooks/useModalA11y";
import { useSessionStore } from "../stores/session-store";
import type { BackgroundProcessRecord, SubAgentRecord, SubAgentTimelineEvent } from "../lib/rpc";
import { IconButton } from "./ui/Button";
import { ModalBackdrop, ModalPanel } from "./ui/Modal";

export interface SubagentPanelProps {
	open: boolean;
	onClose: () => void;
}

/** Escalating duration: ms -> seconds -> 1m -> 1h -> 1d (whole units). */
function formatDuration(ms: number): string {
	const t = Math.max(0, Math.round(ms));
	if (t < 1000) return `${t}ms`;
	if (t < 60_000) return `${(t / 1000).toFixed(t < 10_000 ? 1 : 0)}s`;
	if (t < 3_600_000) return `${Math.floor(t / 60_000)}m`;
	if (t < 86_400_000) return `${Math.floor(t / 3_600_000)}h`;
	return `${Math.floor(t / 86_400_000)}d`;
}

function formatTokens(n: number | undefined): string {
	if (!n || n <= 0) return "";
	if (n < 1000) return `${n} tok`;
	if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}k tok`;
	return `${(n / 1_000_000).toFixed(1)}M tok`;
}

function formatBytes(n: number): string {
	if (n < 1024) return `${n}B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
	return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

function StatusIcon({ status }: { status: SubAgentRecord["status"] }) {
	if (status === "running") return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-pi-accent" />;
	if (status === "completed") return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-pi-success" />;
	return <AlertCircle className="h-3.5 w-3.5 shrink-0 text-pi-error" />;
}

const STATUS_LABEL: Record<SubAgentRecord["status"], string> = {
	running: "Running",
	completed: "Done",
	failed: "Failed",
	killed: "Stopped",
};

function TimelineEntry({ event }: { event: SubAgentTimelineEvent }) {
	switch (event.type) {
		case "tool_use_start":
			return <div className="font-mono text-3xs text-pi-text-muted">→ {event.toolName}</div>;
		case "tool_use_done":
			return (
				<div className={`font-mono text-3xs ${event.isError ? "text-pi-error" : "text-pi-text-muted"}`}>
					{event.isError ? "✗" : "✓"} {event.toolName}
					{event.resultPreview !== undefined && (
						<div className="truncate text-pi-text-faint">⎿ {event.resultPreview}</div>
					)}
				</div>
			);
		case "text": {
			const text = event.text.trim();
			if (!text) return null;
			return (
				<div className="max-h-20 overflow-auto whitespace-pre-wrap text-3xs leading-relaxed text-pi-text-secondary">
					{text}
				</div>
			);
		}
		case "turn_complete":
			return (
				<div className="text-3xs text-pi-text-faint">
					— turn {event.turnCount}
					{event.usage ? ` · ${event.usage.totalTokens.toLocaleString()} tok` : ""}
				</div>
			);
		case "completed":
			return (
				<div className="text-3xs text-pi-success">
					— completed after {event.turnCount} turns, {event.toolUseCount} tools
				</div>
			);
		case "aborted":
			return <div className="text-3xs text-pi-error">— aborted</div>;
	}
}

function SubagentRow({ record, now }: { record: SubAgentRecord; now: number }) {
	const [open, setOpen] = useState(record.status === "running");
	const name = record.teammateName ? `${record.teammateName} · ${record.agentType}` : record.agentType;
	const subtitle = [
		record.model,
		record.toolUseCount > 0 ? `${record.toolUseCount} tools` : "",
		formatTokens(record.totalTokens),
		formatDuration(now - record.startedAt),
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<div className="rounded-lg bg-pi-surface-raised shadow-ring">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="flex w-full items-start gap-2 p-3 text-left"
			>
				<StatusIcon status={record.status} />
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<span className="truncate text-xs font-medium text-pi-text">{name}</span>
						<span className="text-3xs text-pi-text-faint">{STATUS_LABEL[record.status]}</span>
					</div>
					{record.goal ? <p className="mt-1 truncate text-2xs text-pi-text-secondary">{record.goal}</p> : null}
					{subtitle ? <p className="mt-1 font-mono text-3xs text-pi-text-muted">{subtitle}</p> : null}
					{record.error ? (
						<p className="mt-1.5 rounded bg-pi-error/10 px-2 py-1 text-2xs text-pi-error">{record.error}</p>
					) : null}
				</div>
				{open ? (
					<ChevronDown className="h-3.5 w-3.5 shrink-0 text-pi-text-faint" />
				) : (
					<ChevronRight className="h-3.5 w-3.5 shrink-0 text-pi-text-faint" />
				)}
			</button>
			{open ? (
				<div className="flex flex-col gap-1 border-t border-pi-border px-3 py-2">
					{record.timeline && record.timeline.length > 0 ? (
						<>
							<div className="text-3xs font-medium tracking-wider text-pi-text-faint uppercase">Activity</div>
							{record.timeline.slice(-12).map((event, i) => (
								<TimelineEntry event={event} key={i} />
							))}
						</>
					) : (
						<div className="text-3xs text-pi-text-faint">(no activity yet)</div>
					)}
					{record.outputFile ? (
						<div className="mt-1 truncate font-mono text-3xs text-pi-text-faint">log: {record.outputFile}</div>
					) : null}
					{record.worktreePath ? (
						<div className="truncate font-mono text-3xs text-pi-text-faint">worktree: {record.worktreePath}</div>
					) : null}
				</div>
			) : null}
		</div>
	);
}

function BgProcessRow({ record, now }: { record: BackgroundProcessRecord; now: number }) {
	const [open, setOpen] = useState(record.status === "running");
	const elapsed = (record.endedAt ?? now) - record.startedAt;
	const subtitle = [
		record.pid ? `pid ${record.pid}` : "",
		`${record.totalLines} lines`,
		record.totalBytes > 0 ? formatBytes(record.totalBytes) : "",
		formatDuration(elapsed),
		record.exitCode !== undefined ? `exit ${record.exitCode}` : "",
	]
		.filter(Boolean)
		.join(" · ");
	const tail = record.output.split("\n").filter((l) => l.length > 0).slice(-15);
	return (
		<div className="rounded-lg bg-pi-surface-raised shadow-ring">
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				className="flex w-full items-start gap-2 p-3 text-left"
			>
				<StatusIcon
					status={
						record.status === "done"
							? "completed"
							: record.status === "error" || record.status === "killed"
								? "failed"
								: "running"
					}
				/>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<Terminal className="h-3.5 w-3.5 shrink-0 text-pi-text-faint" />
						<span className="truncate font-mono text-xs text-pi-text">$ {record.command}</span>
					</div>
					{subtitle ? <p className="mt-1 font-mono text-3xs text-pi-text-muted">{subtitle}</p> : null}
				</div>
				{open ? (
					<ChevronDown className="h-3.5 w-3.5 shrink-0 text-pi-text-faint" />
				) : (
					<ChevronRight className="h-3.5 w-3.5 shrink-0 text-pi-text-faint" />
				)}
			</button>
			{open ? (
				<div className="flex flex-col gap-1 border-t border-pi-border px-3 py-2">
					{record.fullOutputPath ? (
						<div className="truncate font-mono text-3xs text-pi-text-faint">log: {record.fullOutputPath}</div>
					) : null}
					{tail.length > 0 ? (
						<>
							<div className="text-3xs font-medium tracking-wider text-pi-text-faint uppercase">Output</div>
							{tail.map((line, i) => (
								<div key={i} className="truncate font-mono text-3xs text-pi-text-secondary">
									{line}
								</div>
							))}
						</>
					) : (
						<div className="text-3xs text-pi-text-faint">(no output yet)</div>
					)}
				</div>
			) : null}
		</div>
	);
}

export function SubagentPanel({ open, onClose }: SubagentPanelProps) {
	const modalRef = useRef<HTMLDivElement>(null);
	useModalA11y(modalRef, open, onClose);
	const subAgents = useSessionStore((s) => s.subAgents);
	const backgroundProcesses = useSessionStore((s) => s.backgroundProcesses);
	// Tick elapsed times every second while any sub-agent or process is running.
	const [now, setNow] = useState(() => Date.now());
	useEffect(() => {
		if (!open) return;
		const anyRunning =
			subAgents.some((a) => a.status === "running") ||
			backgroundProcesses.some((p) => p.status === "running");
		if (!anyRunning) return;
		const id = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(id);
	}, [open, subAgents, backgroundProcesses]);

	const sortedAgents = useMemo(
		() => [...subAgents].sort((a, b) => a.startedAt - b.startedAt),
		[subAgents],
	);
	const sortedProcesses = useMemo(
		() => [...backgroundProcesses].sort((a, b) => a.startedAt - b.startedAt),
		[backgroundProcesses],
	);
	const active =
		sortedAgents.filter((a) => a.status === "running").length +
		sortedProcesses.filter((p) => p.status === "running").length;
	const total = sortedAgents.length + sortedProcesses.length;

	if (!open) return null;

	return (
		<ModalBackdrop ref={modalRef} aria-label="Running tasks" onClick={onClose}>
			<ModalPanel className="max-w-lg" centered={false} onClick={(e) => e.stopPropagation()}>
				<div className="flex items-center justify-between border-b border-pi-border px-4 py-3">
					<div className="flex items-center gap-2">
						<Sparkles className="h-4 w-4 text-pi-accent" />
						<h2 className="text-[13px] font-semibold tracking-tight text-pi-text">Running tasks</h2>
						<span className="text-2xs text-pi-text-faint">
							{total} total{active > 0 ? ` · ${active} active` : ""}
						</span>
					</div>
					<IconButton variant="ghost" size="sm" icon={X} onClick={onClose} aria-label="Close" />
				</div>

				<div className="flex-1 overflow-auto px-4 py-3">
					{total === 0 ? (
						<div className="py-10 text-center">
							<p className="text-[13px] font-medium text-pi-text-secondary">No running tasks</p>
							<p className="mt-2 text-2xs leading-relaxed text-pi-text-muted">
								Background bash processes and delegated sub-agents show up here while they run. Ask the
								assistant to delegate a task or background a command.
							</p>
						</div>
					) : (
						<div className="flex flex-col gap-2">
							{sortedAgents.map((agent) => (
								<SubagentRow key={agent.id} record={agent} now={now} />
							))}
							{sortedAgents.length > 0 && sortedProcesses.length > 0 ? (
								<div className="my-1 border-t border-pi-border" />
							) : null}
							{sortedProcesses.map((proc) => (
								<BgProcessRow key={proc.id} record={proc} now={now} />
							))}
						</div>
					)}
				</div>
			</ModalPanel>
		</ModalBackdrop>
	);
}