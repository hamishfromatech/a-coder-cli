import { useMemo } from "react";
import { Check, ChevronRight, ListChecks, User } from "lucide-react";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { useSessionStore } from "../stores/session-store";

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

/** Only these tools snapshot the full task list in details. */
const SNAPSHOT_TOOLS = new Set(["task_create", "task_list", "task_update"]);

/**
 * Persistent task-graph panel. Mirrors the built-in task tools: derives the
 * graph from the most recent task tool result in the session — task_create,
 * task_list, and task_update snapshot the full list in `details.tasks` on
 * every call. Unlike the session `todo` list, tasks persist to disk and can
 * carry dependencies (blockedBy) and owners (Agent Teams teammates).
 */
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

	if (tasks.length === 0) return null;

	const sorted = tasks.slice().sort((a, b) => Number(a.id) - Number(b.id));
	const done = sorted.filter((t) => t.status === "completed").length;
	const inProgress = sorted.find((t) => t.status === "in_progress");
	const percent = Math.round((done / sorted.length) * 100);
	const unresolvedIds = new Set(sorted.filter((t) => t.status !== "completed").map((t) => t.id));

	return (
		<div className="chat-composer shrink-0 pb-1 pt-2">
			<div className="chat-column">
				<div className="rounded-xl border border-pi-border bg-pi-surface/70 px-3 py-2 backdrop-blur transition-smooth">
					<div className="mb-1.5 flex items-center gap-2">
						<ListChecks className="h-3.5 w-3.5 shrink-0 text-pi-accent" />
						<span className="text-2xs font-semibold uppercase tracking-wide text-pi-text-secondary">
							Task Graph
						</span>
						<span className="font-mono pi-tabular text-3xs text-pi-text-faint">
							{done}/{sorted.length}
						</span>
						<div className="ml-auto h-1 w-16 overflow-hidden rounded-full border border-pi-border bg-pi-surface-raised">
							<div
								className="h-full bg-pi-accent transition-all"
								style={{ width: `${Math.min(100, percent)}%` }}
							/>
						</div>
					</div>
					<ul className="flex flex-col gap-0.5">
						{sorted.map((task) => {
							const openBlockers = task.blockedBy.filter((id) => unresolvedIds.has(id));
							const blocked = openBlockers.length > 0;
							return (
								<li key={task.id} className="flex items-start gap-2 text-xs leading-snug">
									{task.status === "completed" ? (
										<Check className="mt-0.5 h-3 w-3 shrink-0 text-pi-success" />
									) : task.status === "in_progress" ? (
										<ChevronRight
											className="mt-0.5 h-3 w-3 shrink-0 animate-pulse text-pi-accent"
											strokeWidth={2.5}
										/>
									) : (
										<span className="mt-1.5 h-2 w-2 shrink-0 rounded-full border border-pi-text-faint" />
									)}
									<span
										className={
											task.status === "completed"
												? "text-pi-text-faint line-through"
												: task.status === "in_progress"
													? "text-pi-text"
													: "text-pi-text-muted"
										}
									>
										{task.status === "in_progress" && task.activeForm
											? task.activeForm
											: task.subject}
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
						})}
					</ul>
					{inProgress && (
						<div className="mt-1.5 flex items-center gap-1.5 text-3xs text-pi-text-faint">
							<span className="pi-dot h-1 w-1 rounded-full bg-pi-accent" />
							<span className="truncate">
								Working: {inProgress.activeForm ?? inProgress.subject}
							</span>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}
