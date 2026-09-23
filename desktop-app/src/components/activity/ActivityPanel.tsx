/**
 * Activity panel — the aggregated inbox: agent runs, pending approvals.
 * "Needs attention" (failures, approvals) sorts to the top; everything else
 * is a reverse-chronological feed. Clicking an item with a session opens it.
 */

import { Inbox, Loader2, X } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../ui/Button";
import {
	useActivityStore,
	type ActivityItem,
	type ActivitySeverity,
} from "../../stores/activity-store";
import { openSessionFile } from "../../lib/open-session";

const SEVERITY_DOT: Record<ActivitySeverity, string> = {
	info: "bg-pi-text-faint",
	success: "bg-pi-success",
	error: "bg-pi-error",
	action: "bg-pi-accent animate-pulse",
};

function relativeTime(ms: number): string {
	const delta = Date.now() - ms;
	if (delta < 60_000) return "just now";
	if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
	if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
	return `${Math.floor(delta / 86_400_000)}d ago`;
}

export function ActivityPanel() {
	const items = useActivityStore((s) => s.items);
	const markSeen = useActivityStore((s) => s.markSeen);
	const dismiss = useActivityStore((s) => s.dismiss);
	const clear = useActivityStore((s) => s.clear);

	const needsAttention = items.filter((i) => i.severity === "error" || i.severity === "action");
	const recent = items.filter((i) => i.severity !== "error" && i.severity !== "action");

	const open = async (item: ActivityItem) => {
		if (item.sessionFile) await openSessionFile(item.sessionFile);
	};

	return (
		<div className="flex h-full min-h-0 flex-col" onMouseEnter={() => markSeen()} onFocus={() => markSeen()}>
			<div className="flex items-center justify-between border-b border-pi-border px-3 py-2">
				<span className="text-xs font-semibold text-pi-text">Activity</span>
				{items.length > 0 && (
					<Button
						variant="ghost"
						size="sm"
						className="text-2xs text-pi-text-muted"
						onClick={() => clear()}
						aria-label="Clear activity"
					>
						Clear
					</Button>
				)}
			</div>

			<div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
				{items.length === 0 && (
					<div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
						<Inbox className="h-5 w-5 text-pi-text-faint" />
						<p className="text-2xs leading-relaxed text-pi-text-faint">
							Quiet. Agent runs, scheduled-task fires, and items needing your approval land here.
						</p>
					</div>
				)}

				{needsAttention.length > 0 && (
					<ActivitySection label="Needs attention">
						{needsAttention.map((item) => (
							<ActivityRow
								key={item.id}
								item={item}
								attention
								onOpen={() => void open(item)}
								onDismiss={() => dismiss(item.id)}
							/>
						))}
					</ActivitySection>
				)}

				{recent.length > 0 && (
					<ActivitySection label="Recent">
						{recent.map((item) => (
							<ActivityRow
								key={item.id}
								item={item}
								onOpen={() => void open(item)}
								onDismiss={() => dismiss(item.id)}
							/>
						))}
					</ActivitySection>
				)}
			</div>
		</div>
	);
}

function ActivitySection({ label, children }: { label: string; children: ReactNode }) {
	return (
		<div className="mb-1">
			<div className="px-1.5 pb-1 pt-2 text-2xs font-medium uppercase tracking-wide text-pi-text-faint">
				{label}
			</div>
			<div className="flex flex-col gap-0.5">{children}</div>
		</div>
	);
}

function ActivityRow({
	item,
	attention,
	onOpen,
	onDismiss,
}: {
	item: ActivityItem;
	attention?: boolean;
	onOpen: () => void;
	onDismiss: () => void;
}) {
	return (
		<div
			className={`group flex w-full items-start gap-2 rounded-md px-1.5 py-1.5 transition-hover ${
				attention ? "bg-pi-surface-raised/60" : ""
			} ${item.sessionFile ? "cursor-pointer hover:bg-pi-surface-raised" : "hover:bg-pi-surface-raised/50"}`}
			role={item.sessionFile ? "button" : undefined}
			tabIndex={item.sessionFile ? 0 : undefined}
			onClick={item.sessionFile ? onOpen : undefined}
			onKeyDown={
				item.sessionFile
					? (e) => {
							if (e.key === "Enter" || e.key === " ") {
								e.preventDefault();
								onOpen();
							}
						}
					: undefined
			}
		>
			<span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_DOT[item.severity]}`} />
			<div className="min-w-0 flex-1">
					<div className="flex items-baseline gap-1.5">
					{item.running && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-pi-text-muted" />}
					<span className="truncate text-xs font-medium text-pi-text">{item.title}</span>
				</div>
				{item.detail && !item.running && (
					<div className="mt-0.5 line-clamp-2 text-2xs leading-relaxed text-pi-text-muted">{item.detail}</div>
				)}
				<div className="mt-0.5 text-2xs text-pi-text-faint">{relativeTime(item.at)}</div>
			</div>
			<button
				type="button"
				className="mt-0.5 hidden h-5 w-5 shrink-0 items-center justify-center rounded text-pi-text-faint hover:bg-pi-surface-raised hover:text-pi-text group-hover:flex"
				aria-label="Dismiss"
				onClick={(e) => {
					e.stopPropagation();
					onDismiss();
				}}
			>
				<X className="h-3 w-3" />
			</button>
		</div>
	);
}