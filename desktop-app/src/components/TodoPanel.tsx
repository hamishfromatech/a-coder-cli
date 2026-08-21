import { useEffect, useMemo, useState } from "react";
import { Check, ChevronRight, ListTodo } from "lucide-react";
import type { ToolResultMessage } from "@theatechcorporation/pi-ai";
import { useSessionStore } from "../stores/session-store";

export interface TodoItem {
	text: string;
	status: "pending" | "in_progress" | "completed";
	activeForm?: string;
}

interface TodoDetails {
	todos?: TodoItem[];
}

/**
 * Inline task list that mirrors the built-in `todo` tool. Derives the latest
 * list from the most recent `todo` tool result in the session — the tool result
 * snapshots the full list in `details.todos` on every call, so this stays in
 * sync with the model's plan as it works. Rendered inline above the composer
 * (Hermes-style status stack). Hidden when there is no list.
 */
export function TodoPanel() {
	const messages = useSessionStore((s) => s.messages);

	const todos = useMemo<TodoItem[]>(() => {
		for (let i = messages.length - 1; i >= 0; i--) {
			const msg = messages[i];
			if (msg.role !== "toolResult") continue;
			const result = msg as ToolResultMessage;
			if (result.toolName !== "todo") continue;
			const details = result.details as TodoDetails | undefined;
			return details?.todos ?? [];
		}
		return [];
	}, [messages]);

	const [highlight, setHighlight] = useState(false);
	useEffect(() => {
		const onFocus = () => {
			setHighlight(true);
			setTimeout(() => setHighlight(false), 1200);
		};
		window.addEventListener("a-coder:focus-todos", onFocus);
		return () => window.removeEventListener("a-coder:focus-todos", onFocus);
	}, []);

	const allDone = todos.length > 0 && todos.every((t) => t.status === "completed");
	const [hideCompleted, setHideCompleted] = useState(false);
	useEffect(() => {
		// Once every task is completed, let the user briefly see the finished list,
		// then collapse the panel. Reopens automatically if a new task is added.
		if (!allDone) {
			setHideCompleted(false);
			return;
		}
		const timer = setTimeout(() => setHideCompleted(true), 1500);
		return () => clearTimeout(timer);
	}, [allDone]);

	if (todos.length === 0 || hideCompleted) return null;

	const done = todos.filter((t) => t.status === "completed").length;
	const inProgress = todos.find((t) => t.status === "in_progress");
	const percent = Math.round((done / todos.length) * 100);

	return (
		<div className="chat-composer shrink-0 pb-1 pt-2">
			<div className="chat-column">
				<div className={`rounded-xl border border-pi-border bg-pi-surface/70 px-3 py-2 backdrop-blur transition-smooth ${highlight ? "ring-2 ring-pi-accent" : ""}`}>
					<div className="mb-1.5 flex items-center gap-2">
						<ListTodo className="h-3.5 w-3.5 shrink-0 text-pi-accent" />
						<span className="text-2xs font-semibold uppercase tracking-wide text-pi-text-secondary">
							Tasks
						</span>
						<span className="font-mono pi-tabular text-3xs text-pi-text-faint">
							{done}/{todos.length}
						</span>
						<div className="ml-auto h-1 w-16 overflow-hidden rounded-full border border-pi-border bg-pi-surface-raised">
							<div
								className="h-full bg-pi-accent transition-all"
								style={{ width: `${Math.min(100, percent)}%` }}
							/>
						</div>
					</div>
					<ul className="flex flex-col gap-0.5">
						{todos.map((t, i) => (
							<li key={i} className="flex items-start gap-2 text-xs leading-snug">
								{t.status === "completed" ? (
									<Check className="mt-0.5 h-3 w-3 shrink-0 text-pi-success" />
								) : t.status === "in_progress" ? (
									<ChevronRight
										className="mt-0.5 h-3 w-3 shrink-0 animate-pulse text-pi-accent"
										strokeWidth={2.5}
									/>
								) : (
									<span className="mt-1.5 h-2 w-2 shrink-0 rounded-full border border-pi-text-faint" />
								)}
								<span
									className={
										t.status === "completed"
											? "text-pi-text-faint line-through"
											: t.status === "in_progress"
												? "text-pi-text"
												: "text-pi-text-muted"
									}
								>
									{t.status === "in_progress" && t.activeForm ? t.activeForm : t.text}
								</span>
							</li>
						))}
					</ul>
					{inProgress && (
						<div className="mt-1.5 flex items-center gap-1.5 text-3xs text-pi-text-faint">
							<span className="pi-dot h-1 w-1 rounded-full bg-pi-accent" />
							<span className="truncate">
								Working: {inProgress.activeForm ?? inProgress.text}
							</span>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}