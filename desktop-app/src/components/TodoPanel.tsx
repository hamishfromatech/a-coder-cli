import { useEffect, useMemo, useState } from "react";
import { Check, ChevronDown, ListTodo } from "lucide-react";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { useSessionStore } from "../stores/session-store";
import { cn } from "../lib/cn";

export interface TodoItem {
	text: string;
	status: "pending" | "in_progress" | "completed";
	activeForm?: string;
}

interface TodoDetails {
	todos?: TodoItem[];
}

// Inline task list that mirrors the built-in `todo` tool. Derives the latest
// list from the most recent `todo` tool result in the session. Rendered inline
// above the composer as a Hermes-style collapsible status section.
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
		if (!allDone) {
			setHideCompleted(false);
			return;
		}
		const timer = setTimeout(() => setHideCompleted(true), 1500);
		return () => clearTimeout(timer);
	}, [allDone]);

	const [collapsed, setCollapsed] = useState(false);

	if (todos.length === 0 || hideCompleted) return null;

	const done = todos.filter((t) => t.status === "completed").length;
	const inProgress = todos.find((t) => t.status === "in_progress");
	const percent = Math.round((done / todos.length) * 100);
	const running = Boolean(inProgress);

	return (
		<div className="chat-composer shrink-0 pb-1 pt-2">
			<div className="chat-column">
				<div
					className={cn(
						"rounded-xl border border-pi-border bg-pi-surface/70 backdrop-blur transition-smooth",
						highlight && "ring-2 ring-pi-accent",
					)}
				>
					<button
						type="button"
						onClick={() => setCollapsed((v) => !v)}
						className="flex w-full items-center gap-2 px-3 py-2 text-left transition-hover hover:bg-pi-surface-raised/50"
					>
						<ListTodo className="h-3.5 w-3.5 shrink-0 text-pi-accent" />
						<span className="min-w-0 flex-1 truncate text-2xs font-semibold uppercase tracking-wide text-pi-text-secondary">
							Tasks
						</span>
						<span className="font-mono pi-tabular text-3xs text-pi-text-faint">
							{done}/{todos.length}
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
							{todos.map((t, i) => (
								<TodoRow key={i} item={t} />
							))}
						</ul>
					)}
				</div>
			</div>
		</div>
	);
}

function TodoRow({ item }: { item: TodoItem }) {
	return (
		<li className="group flex min-h-6 items-center gap-2 rounded-md px-1.5 py-1 transition-hover hover:bg-pi-surface-raised/50">
			<span className="flex size-3.5 shrink-0 items-center justify-center">
				{item.status === "completed" ? (
					<Check className="h-3 w-3 text-pi-success" />
				) : item.status === "in_progress" ? (
					<span className="pi-dot h-2 w-2 rounded-full bg-pi-accent" />
				) : (
					<span className="box-border size-[0.45rem] rounded-full border border-dashed border-pi-text-faint" />
				)}
			</span>
			<span
				className={cn(
					"min-w-0 flex-1 truncate text-xs leading-4",
					item.status === "completed"
						? "text-pi-text-faint line-through"
						: item.status === "in_progress"
							? "text-pi-text"
							: "text-pi-text-muted",
					item.status === "in_progress" && item.activeForm && "italic",
				)}
			>
				{item.status === "in_progress" && item.activeForm ? item.activeForm : item.text}
			</span>
		</li>
	);
}
