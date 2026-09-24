import { useState } from "react";
import { ChevronDown, Clock3, CornerDownLeft, Inbox, X, Zap } from "lucide-react";
import { useSessionStore } from "../stores/session-store";
import { removeQueued } from "../lib/rpc";
import { toast } from "../stores/toast-store";
import { cn } from "../lib/cn";

export interface QueuePanelProps {
	/** Called when the user clicks a queued item to restore it into the composer.
	 * The item is removed from the queue first so it is not delivered twice. */
	onSend?: (text: string) => void;
}

interface QueueItem {
	text: string;
	kind: "steering" | "followUp";
	index: number;
}

// Queued steering/follow-up messages — same Hermes-style collapsible card as
// the TaskPanel (task graph) and RuntimePanel (sub-agents / background
// terminals), mounted in the same chat-column slot above the composer.
export function QueuePanel({ onSend }: QueuePanelProps) {
	const { steering, followUp } = useSessionStore();
	const [collapsed, setCollapsed] = useState(false);

	const items = [
		...steering.map((text, index) => ({ text, kind: "steering" as const, index })),
		...followUp.map((text, index) => ({ text, kind: "followUp" as const, index })),
	];

	if (items.length === 0) return null;

	const removeItem = async (item: QueueItem) => {
		try {
			const res = await removeQueued(item.kind, item.index);
			if (!res.removed) {
				toast.warning("Message may still be queued", "The engine reported nothing was removed");
			}
		} catch (e) {
			toast.error("Failed to remove queued message", e instanceof Error ? e.message : String(e));
		}
	};

	const restoreItem = async (item: QueueItem) => {
		// Remove from the queue first: restoring into the composer is meant for
		// edit-then-send, and leaving the item queued would deliver it twice.
		try {
			const res = await removeQueued(item.kind, item.index);
			if (!res.removed) {
				toast.warning("Message may still be queued", "The engine reported nothing was removed");
			}
		} catch (e) {
			toast.error("Failed to remove queued message", e instanceof Error ? e.message : String(e));
		}
		onSend?.(item.text);
	};

	return (
		<div className="chat-column pb-1.5">
			<div className="rounded-xl border border-pi-border bg-pi-surface/70 backdrop-blur transition-smooth">
				<button
					type="button"
					onClick={() => setCollapsed((v) => !v)}
					className="flex w-full items-center gap-2 px-3 py-2 text-left transition-hover hover:bg-pi-surface-raised/50"
				>
					<Inbox className="h-3.5 w-3.5 shrink-0 text-pi-accent" />
					<span className="min-w-0 flex-1 truncate text-2xs font-semibold uppercase tracking-wide text-pi-text-secondary">
						Queued
					</span>
					<span className="font-mono pi-tabular text-3xs text-pi-text-faint">{items.length}</span>
					<span className="pi-dot h-1 w-1 rounded-full bg-pi-accent" />
					<ChevronDown
						className={cn(
							"h-3 w-3 shrink-0 text-pi-text-faint transition-smooth",
							collapsed && "-rotate-90",
						)}
					/>
				</button>

				{!collapsed && (
					<div className="flex flex-col gap-0.5 px-3 pb-2">
						{items.map((item) => (
							<QueueRow
								key={`${item.kind}-${item.index}`}
								item={item}
								onRestore={() => void restoreItem(item)}
								onRemove={() => void removeItem(item)}
							/>
						))}
					</div>
				)}
			</div>
		</div>
	);
}

function QueueRow({
	item,
	onRestore,
	onRemove,
}: {
	item: QueueItem;
	onRestore: () => void;
	onRemove: () => void;
}) {
	const steering = item.kind === "steering";
	return (
		<div
			role="button"
			tabIndex={0}
			onClick={onRestore}
			onKeyDown={(e) => {
				if (e.key === "Enter" || e.key === " ") {
					e.preventDefault();
					onRestore();
				}
			}}
			className="group flex min-h-6 cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-left transition-hover hover:bg-pi-surface-raised/50 focus-visible:shadow-focus focus-visible:outline-none"
		>
			<span className="flex size-3.5 shrink-0 items-center justify-center" aria-hidden>
				{steering ? (
					<Zap className="h-3 w-3 text-pi-accent" />
				) : (
					<Clock3 className="h-3 w-3 text-pi-text-faint" />
				)}
			</span>
			<span className="min-w-0 flex-1 truncate text-xs leading-4 text-pi-text">
				{item.text}
			</span>
			<span
				className={cn(
					"shrink-0 font-mono text-3xs",
					steering ? "text-pi-accent" : "text-pi-success",
				)}
			>
				{steering ? "steer" : "follow-up"}
			</span>
			<CornerDownLeft
				className="h-3 w-3 shrink-0 text-pi-text-faint opacity-0 transition-smooth group-hover:opacity-100"
				aria-label="Restore to composer"
			/>
			<button
				type="button"
				tabIndex={-1}
				onClick={(e) => {
					e.stopPropagation();
					onRemove();
				}}
				onKeyDown={(e) => e.stopPropagation()}
				className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-pi-text-faint opacity-0 transition-hover hover:text-pi-error group-hover:opacity-100"
				aria-label="Remove queued message"
			>
				<X className="h-3 w-3" />
			</button>
		</div>
	);
}