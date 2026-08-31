import { useEffect, useMemo, useState } from "react";
import { Bot, Check, ChevronDown, Sparkles, Terminal, X } from "lucide-react";
import { useSessionStore } from "../stores/session-store";
import type { BackgroundProcessRecord, SubAgentRecord } from "../lib/rpc";
import { cn } from "../lib/cn";

// Inline agents card — same Hermes-style collapsible treatment as the
// TodoPanel (task list) and TaskPanel (task graph), mounted in the same
// chat-composer slot. Surfaces running/recent sub-agents and background
// terminal processes as compact rows so they stay visible inline in the
// transcript instead of only living inside the SubagentPanel modal.
// Clicking a row opens the full viewer modal for logs and details.

/** Show finished runs for 2 minutes, then drop them (matches TodoPanel's
 *  settle-then-hide behaviour). */
const FINISHED_TTL_MS = 120_000;

const isStale = (finishedAt: number) => Date.now() - finishedAt > FINISHED_TTL_MS;

function subVisible(sub: SubAgentRecord): boolean {
	if (sub.status === "running") return true;
	return !isStale(sub.updatedAt);
}

function bgVisible(p: BackgroundProcessRecord): boolean {
	if (p.status === "running") return true;
	return !isStale(p.endedAt ?? p.startedAt);
}

/** Escalating duration: ms -> seconds -> 1m -> 1h (whole units, compact). */
function formatDuration(ms: number): string {
	const t = Math.max(0, Math.round(ms));
	if (t < 1000) return `${t}ms`;
	if (t < 60_000) return `${(t / 1000).toFixed(t < 10_000 ? 1 : 0)}s`;
	if (t < 3_600_000) return `${Math.floor(t / 60_000)}m`;
	return `${Math.floor(t / 3_600_000)}h`;
}

function formatTokens(n: number | undefined): string {
	if (!n || n <= 0) return "";
	if (n < 1000) return `${n} tok`;
	if (n < 1_000_000) return `${n < 10_000 ? (n / 1000).toFixed(1) : Math.round(n / 1000)}k tok`;
	return `${(n / 1_000_000).toFixed(1)}M tok`;
}

/** One command per row: strip trailing whitespace, collapse newlines. */
function oneLine(cmd: string): string {
	return cmd.replace(/\s+/g, " ").trim();
}

export function RuntimePanel() {
	const subAgents = useSessionStore((s) => s.subAgents);
	const backgroundProcesses = useSessionStore((s) => s.backgroundProcesses);

	// Ticker so live durations advance while the panel is on screen.
	const [, setNow] = useState(0);
	const anyRunning = useMemo(
		() =>
			subAgents.some((a) => a.status === "running") ||
			backgroundProcesses.some((p) => p.status === "running"),
		[subAgents, backgroundProcesses],
	);
	useEffect(() => {
		if (!anyRunning) return;
		const t = setInterval(() => setNow(Date.now()), 1000);
		return () => clearInterval(t);
	}, [anyRunning]);

	const subs = useMemo<SubAgentRecord[]>(
		() =>
			subAgents
				.filter((rec) => subVisible(rec))
				.sort((a, b) => a.startedAt - b.startedAt),
		[subAgents],
	);

	const bgs = useMemo<BackgroundProcessRecord[]>(
		() => backgroundProcesses.filter((rec) => bgVisible(rec)).sort((a, b) => a.startedAt - b.startedAt),
		[backgroundProcesses],
	);

	const [collapsed, setCollapsed] = useState(false);

	// All done → fold up shortly after, like the task list.
	useEffect(() => {
		if (anyRunning || subs.length + bgs.length === 0) {
			setCollapsed(false);
			return;
		}
		const t = setTimeout(() => setCollapsed(true), 2_500);
		return () => clearTimeout(t);
	}, [anyRunning, subs.length, bgs.length]);

	const openViewer = () => window.dispatchEvent(new CustomEvent("a-coder:open-subagents"));

	if (subs.length + bgs.length === 0) return null;

	const activeCount =
		subs.filter((rec) => rec.status === "running").length +
		bgs.filter((rec) => rec.status === "running").length;

	return (
		<div className="chat-composer shrink-0 pb-1 pt-2">
			<div className="chat-column">
				<div className="rounded-xl border border-pi-border bg-pi-surface/70 backdrop-blur transition-smooth">
					<button
						type="button"
						onClick={() => setCollapsed((v) => !v)}
						className="flex w-full items-center gap-2 px-3 py-2 text-left transition-hover hover:bg-pi-surface-raised/50"
					>
						<Bot className="h-3.5 w-3.5 shrink-0 text-pi-accent" />
						<span className="min-w-0 flex-1 truncate text-2xs font-semibold uppercase tracking-wide text-pi-text-secondary">
							Agents
						</span>
						<span className="font-mono pi-tabular text-3xs text-pi-text-faint">
							{subs.length + bgs.length}
						</span>
						{activeCount > 0 && (
							<span className="pi-dot h-1 w-1 rounded-full bg-pi-accent" />
						)}
						<ChevronDown
							className={cn(
								"h-3 w-3 shrink-0 text-pi-text-faint transition-smooth",
								collapsed && "-rotate-90",
							)}
						/>
					</button>

					{!collapsed && (
						<div className="flex flex-col gap-1 px-3 pb-2">
							{subs.length > 0 && (
								<p className="px-1.5 pt-1 text-4xs font-medium uppercase tracking-[0.08em] text-pi-text-faint">
									Sub-agents
								</p>
							)}
			{subs.map((rec) => (
								<SubAgentRow key={rec.id} sub={rec} onOpen={openViewer} />
							))}
							{bgs.length > 0 && (
								<p className="px-1.5 pt-2 text-4xs font-medium uppercase tracking-[0.08em] text-pi-text-faint">
									Background terminal
								</p>
							)}
							{bgs.map((rec) => (
								<BackgroundRow key={rec.id} proc={rec} onOpen={openViewer} />
							))}
							<button
								type="button"
								onClick={openViewer}
								className="mt-1 self-start rounded-md px-1.5 py-0.5 font-mono text-3xs text-pi-text-faint transition-hover hover:bg-pi-surface-raised hover:text-pi-text"
							>
								Full logs &amp; details ↗
							</button>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

function SubAgentRow({ sub, onOpen }: { sub: SubAgentRecord; onOpen: () => void }) {
	const running = sub.status === "running";
	const duration = (running ? Date.now() : sub.updatedAt) - sub.startedAt;
	return (
		<button
			type="button"
			onClick={onOpen}
			className="group flex min-h-6 w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-hover hover:bg-pi-surface-raised/50"
		>
			<StatusGlyph status={sub.status} />
			<span className="flex size-3.5 shrink-0 items-center justify-center text-pi-text-faint" aria-hidden>
				<Sparkles className="h-3 w-3" />
			</span>
			<span className="min-w-0 flex-1 truncate text-xs leading-4">
				<span className="font-mono text-pi-text">{sub.agentType}</span>
				{sub.goal && <span className="text-pi-text-muted"> — {sub.goal}</span>}
			</span>
			{running && sub.totalTokens ? (
				<span className="hidden shrink-0 font-mono text-3xs text-pi-text-faint sm:inline">
					{formatTokens(sub.totalTokens)}
				</span>
			) : null}
			<span
				className={cn(
					"shrink-0 font-mono text-3xs",
					running ? "text-pi-accent" : sub.status === "completed" ? "text-pi-success" : "text-pi-error",
				)}
			>
				{running ? formatDuration(duration) : sub.status === "completed" ? `${formatDuration(duration)} · done` : sub.status}
			</span>
		</button>
	);
}

function BackgroundRow({ proc, onOpen }: { proc: BackgroundProcessRecord; onOpen: () => void }) {
	const running = proc.status === "running";
	const duration = (proc.endedAt ?? Date.now()) - proc.startedAt;
	return (
		<button
			type="button"
			onClick={onOpen}
			className="group flex min-h-6 w-full items-center gap-2 rounded-md px-1.5 py-1 text-left transition-hover hover:bg-pi-surface-raised/50"
		>
			<StatusGlyph status={proc.status} />
			<span className="flex size-3.5 shrink-0 items-center justify-center text-pi-text-faint" aria-hidden>
				<Terminal className="h-3 w-3" />
			</span>
			<span className="min-w-0 flex-1 truncate font-mono text-xs leading-4 text-pi-text">
				{oneLine(proc.command) || "background command"}
			</span>
			{proc.exitCode !== undefined && proc.exitCode !== 0 && (
				<span className="shrink-0 font-mono text-3xs text-pi-error">exit {proc.exitCode}</span>
			)}
			<span
				className={cn(
					"shrink-0 font-mono text-3xs",
					running ? "text-pi-accent" : proc.status === "done" ? "text-pi-success" : "text-pi-error",
				)}
			>
				{running
					? formatDuration(Date.now() - proc.startedAt)
					: proc.status === "done"
						? `${formatDuration(duration)} · done`
						: proc.status}
			</span>
		</button>
	);
}

function StatusGlyph({ status }: { status: string }) {
	if (status === "running") {
		return (
			<span className="flex size-3.5 shrink-0 items-center justify-center">
				<span className="pi-dot h-2 w-2 animate-pulse rounded-full bg-pi-accent" />
			</span>
		);
	}
	if (status === "completed" || status === "done") {
		return (
			<span className="flex size-3.5 shrink-0 items-center justify-center">
				<Check className="h-3 w-3 text-pi-success" />
			</span>
		);
	}
	if (status === "killed") {
		return (
			<span className="flex size-3.5 shrink-0 items-center justify-center">
				<X className="h-3 w-3 text-pi-text-faint" />
			</span>
		);
	}
	return (
		<span className="flex size-3.5 shrink-0 items-center justify-center">
			<X className="h-3 w-3 text-pi-error" />
		</span>
	);
}