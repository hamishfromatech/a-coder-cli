import { useMemo, useState } from "react";
import { Check, ChevronDown, ListChecks, User } from "lucide-react";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { useSessionStore } from "../stores/session-store";
import { cn } from "../lib/cn";

export interface TaskItem {
	id: string;
	subject: string;
	description: string;
	activeForm?: string;
	owner?: string;
	status: "pending" | "in_progress" | "completed";
	blocks: string[];
	blockedBy: string[];
	metadata?: Record<string, unknown>;
}

interface TaskDetails {
	tasks?: TaskItem[];
}

const SNAPSHOT_TOOLS = new Set(["task_create", "task_list", "task_update"]);

// Persistent task-graph panel. Mirrors the built-in task tools and renders as
// a Hermes-style collapsible status section above the composer.
export function TaskPanel() {
	const messages = useSessionStore((s) => s.messages);

	const tasks = useMemo<TaskItem[]>(() => {
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg.role !== "toolResult") continue;
			const result = msg as ToolResultMessage;
			if (!SNAPSHOT_TOOLS.has(result.toolName)) continue;
			const details = result.details as TaskDetails | undefined;
			return details?.tasks ?? [];
		}
		return [];
	}, [messages]);

	const [collapsed, setCollapsed] = useState(false);

	if (tasks.length === 0) return null;

	const sorted = tasks.slice().sort((a, b) => Number(a.id) - Number(b.id));
	const done = sorted.filter((t) => t.status === "completed").length;
	const inProgress = sorted.find((t) => t.status === "in_progress");
	const percent = Math.round((done / sorted.length) * 100);
	const unresolvedIds = new Set(sorted.filter((t) => t.status !== "completed").map((t) => t.id));
	const running = Boolean(inProgress);

	return (
		<div className="chat-composer shrink-0 pb-1 pt-2">
			<div className="chat-column">
				<div className="rounded-xl border border-pi-border bg-pi-surface/70 backdrop-blur transition-smooth">
					<button
						type="button"
						onClick={() => setCollapsed((v) => !v)}
						className="flex w-full items-center gap-2 px-3 py-2 text-left transition-hover hover:bg-pi-surface-raised/50"
					>
						<ListChecks className="h-3.5 w-3.5 shrink-0 text-pi-accent" />
						<span className="min-w-0 flex-1 truncate text-2xs font-semibold uppercase tracking-wide text-pi-text-secondary">
							Task Graph
						</span>
						<span className="font-mono pi-tabular text-3xs text-pi-text-faint">
							{done}/{sorted.length}
						</span>
						{running && collapsed && (
							<span className="pi-dot h-1 w-1 rounded-full bg-pi-accent" />
						)}
						<div className="ml-1 h-1 w-16 overflow-hidden rounded-full border border-pi-border bg-pi-surface-raised">
							<div
								className="h-full bg-pi-accent transition-all"
								style={{ width: `${Math.min(100, percent)}%` }}
							/>
						</div>
						<ChevronDown
							className={cn(
								"h-3 w-3 shrink-0 text-pi-text-faint transition-smooth",
								collapsed && "-rotate-90",
							)}
						/>
					</button>

					{!collapsed && (
						<ul className="flex flex-col gap-0.5 px-3 pb-2">
							{sorted.map((task) => (
								<TaskRow
									key={task.id}
									task={task}
									openBlockers={task.blockedBy.filter((id) => unresolvedIds.has(id))}
								/>
							))}
						</ul>
					)}
				</div>
			</div>
		</div>
	);
}

function TaskRow({
	task,
	openBlockers,
}: {
	task: TaskItem;
	openBlockers: string[];
}) {
	const blocked = openBlockers.length > 0;
	const working = task.status === "in_progress" && task.activeForm;
	return (
		<li className="group flex min-h-6 items-start gap-2 rounded-md px-1.5 py-1 transition-hover hover:bg-pi-surface-raised/50">
			<span className="flex size-3.5 shrink-0 items-center justify-center pt-0.5">
				{task.status === "completed" ? (
					<Check className="h-3 w-3 text-pi-success" />
				) : task.status === "in_progress" ? (
					<span className="pi-dot h-2 w-2 rounded-full bg-pi-accent" />
				) : (
					<span className="box-border size-[0.45rem] rounded-full border border-dashed border-pi-text-faint" />
				)}
			</span>
			<span
				className={cn(
					"min-w-0 flex-1 text-xs leading-4",
					task.status === "completed"
						? "text-pi-text-faint line-through"
						: task.status === "in_progress"
							? "text-pi-text"
							: "text-pi-text-muted",
				)}
			>
				<span className={cn(working && "italic")}>
					{working ? task.activeForm : task.subject}
				</span>
				{task.owner && (
					<span className="ml-1.5 inline-flex items-center gap-0.5 text-3xs text-pi-text-faint">
						<User className="h-2.5 w-2.5" />
						{task.owner}
					</span>
				)}
				{blocked && (
					<span className="ml-1.5 text-3xs text-pi-warning">
						blocked by {openBlockers.map((id) => `#${id}`).join(", ")}
					</span>
				)}
			</span>
		</li>
	);
}
