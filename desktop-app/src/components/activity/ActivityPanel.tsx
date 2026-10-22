/**
 * Decisions — the unified attention surface: scheduled-run triage, approvals,
 * failed runs, and agent-created work. Open items are grouped by urgency;
 * dismissed/resolved items move to History. Keyboard-first: j/k move,
 * Enter opens, x dismisses, s snoozes, a resolves, u restores in History.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Archive, Check, Clock3, Inbox, Loader2, RotateCcw, X } from "lucide-react";
import { Button } from "../ui/Button";
import { FadeScroll } from "../ui/FadeScroll";
import {
	activityStatus,
	isAttentionItem,
	selectHistoryItems,
	selectOpenItems,
	selectSnoozedItems,
	useActivityStore,
	type ActivityItem,
	type ActivityOrigin,
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

type View = "open" | "history";
type OriginFilter = "all" | ActivityOrigin;

export function ActivityPanel() {
	const items = useActivityStore((s) => s.items);
	const markSeen = useActivityStore((s) => s.markSeen);
	const dismiss = useActivityStore((s) => s.dismiss);
	const snooze = useActivityStore((s) => s.snooze);
	const resolve = useActivityStore((s) => s.resolve);
	const restore = useActivityStore((s) => s.restore);
	const clearHistory = useActivityStore((s) => s.clearHistory);
	const [view, setView] = useState<View>("open");
	const [origin, setOrigin] = useState<OriginFilter>("all");
	const [selected, setSelected] = useState(0);
	const listRef = useRef<HTMLDivElement | null>(null);

	const open = useMemo(() => selectOpenItems(items), [items]);
	const snoozed = useMemo(() => selectSnoozedItems(items), [items]);
	const history = useMemo(() => selectHistoryItems(items), [items]);
	const byOrigin = useMemo(
		() => (item: ActivityItem) => origin === "all" || item.origin === origin,
		[origin],
	);
	const attention = useMemo(() => open.filter((item) => isAttentionItem(item) && byOrigin(item)), [open, byOrigin]);
	const recent = useMemo(
		() => open.filter((item) => !isAttentionItem(item) && byOrigin(item)),
		[open, byOrigin],
	);
	const snoozedVisible = useMemo(() => snoozed.filter(byOrigin), [snoozed, byOrigin]);
	const historyVisible = useMemo(() => history.filter(byOrigin), [history, byOrigin]);
	const visible = view === "open" ? [...attention, ...recent] : historyVisible;

	useEffect(() => {
		setSelected((current) => Math.min(current, Math.max(0, visible.length - 1)));
	}, [visible.length]);

	useEffect(() => {
		const row = listRef.current?.querySelector<HTMLElement>(`[data-decision-index="${selected}"]`);
		row?.scrollIntoView({ block: "nearest" });
	}, [selected]);

	const openItem = async (item: ActivityItem) => {
		if (item.sessionFile) await openSessionFile(item.sessionFile);
	};

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
			const target = event.target as HTMLElement | null;
			if (
				target &&
				(target.tagName === "INPUT" ||
					target.tagName === "TEXTAREA" ||
					target.tagName === "SELECT" ||
					target.isContentEditable)
			) {
				return;
			}
			if (event.key === "j" || event.key === "ArrowDown") {
				event.preventDefault();
				setSelected((current) => Math.min(current + 1, Math.max(0, visible.length - 1)));
				return;
			}
			if (event.key === "k" || event.key === "ArrowUp") {
				event.preventDefault();
				setSelected((current) => Math.max(0, current - 1));
				return;
			}
			const item = visible[selected];
			if (!item) return;
			if (event.key === "Enter") {
				event.preventDefault();
				void openItem(item);
				return;
			}
			if (event.key === "x") {
				event.preventDefault();
				dismiss(item.key);
				return;
			}
			if (event.key === "s") {
				event.preventDefault();
				snooze(item.key, Date.now() + 60 * 60_000);
				return;
			}
			if (event.key === "a") {
				event.preventDefault();
				resolve(item.key);
				return;
			}
			if (event.key === "u" && view === "history") {
				event.preventDefault();
				restore(item.key);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [visible, selected, dismiss, snooze, resolve, restore, view]);

	return (
		<div className="flex h-full min-h-0 flex-col" onMouseEnter={() => markSeen()} onFocus={() => markSeen()}>
			<div className="border-b border-pi-border px-3 py-2">
				<div className="flex items-center justify-between gap-2">
					<span className="text-xs font-semibold text-pi-text">Decisions</span>
					<div className="flex items-center gap-1">
						<Button
							variant={view === "open" ? "secondary" : "ghost"}
							size="xs"
							onClick={() => {
								setView("open");
								setSelected(0);
							}}
						>
							Open{attention.length > 0 ? ` ${attention.length}` : ""}
						</Button>
						<Button
							variant={view === "history" ? "secondary" : "ghost"}
							size="xs"
							onClick={() => {
								setView("history");
								setSelected(0);
							}}
						>
							History{historyVisible.length > 0 ? ` ${historyVisible.length}` : ""}
						</Button>
					</div>
				</div>
				<div className="mt-1.5 flex items-center justify-between gap-2">
					<select
						value={origin}
						onChange={(event) => setOrigin(event.target.value as OriginFilter)}
						className="rounded-md bg-pi-surface-raised px-2 py-1 text-2xs text-pi-text-muted shadow-ring focus:shadow-focus focus:outline-none"
						aria-label="Filter decisions by source"
					>
						<option value="all">All sources</option>
						<option value="human">Human</option>
						<option value="automation">Automation</option>
					</select>
					{view === "history" && historyVisible.length > 0 && (
						<button
							type="button"
							className="text-2xs text-pi-text-faint hover:text-pi-text"
							onClick={() => clearHistory()}
						>
							Clear history
						</button>
					)}
					<span className="text-2xs text-pi-text-faint">j/k · enter · x · s · a</span>
				</div>
			</div>

			<FadeScroll className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-4">
				<div ref={listRef}>
					{visible.length === 0 && (
						<div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
							<Inbox className="h-5 w-5 text-pi-text-faint" />
							<p className="text-2xs leading-relaxed text-pi-text-faint">
								{view === "history"
									? "No resolved or dismissed decisions yet."
									: "Quiet. Scheduled-task triage, approvals, and failed runs land here when they need you."}
							</p>
						</div>
					)}

					{view === "open" && attention.length > 0 && (
						<ActivitySection label="Needs attention">
							{attention.map((item) => {
								const index = visible.indexOf(item);
								return (
									<ActivityRow
										key={item.id}
										index={index}
										selected={index === selected}
										item={item}
										attention
										onSelect={() => setSelected(index)}
										onOpen={() => void openItem(item)}
										onDismiss={() => dismiss(item.key)}
										onSnooze={() => snooze(item.key, Date.now() + 60 * 60_000)}
										onResolve={() => resolve(item.key)}
									/>
								);
							})}
						</ActivitySection>
					)}

					{view === "open" && recent.length > 0 && (
						<ActivitySection label="Recent">
							{recent.map((item) => {
								const index = visible.indexOf(item);
								return (
									<ActivityRow
										key={item.id}
										index={index}
										selected={index === selected}
										item={item}
										onSelect={() => setSelected(index)}
										onOpen={() => void openItem(item)}
										onDismiss={() => dismiss(item.key)}
										onSnooze={() => snooze(item.key, Date.now() + 60 * 60_000)}
										onResolve={() => resolve(item.key)}
									/>
								);
							})}
						</ActivitySection>
					)}

					{view === "open" && snoozedVisible.length > 0 && (
						<ActivitySection label="Snoozed">
							{snoozedVisible.map((item) => (
								<ActivityRow
									key={item.id}
									index={-1}
									selected={false}
									item={item}
									onSelect={() => {}}
									onOpen={() => void openItem(item)}
									onRestore={() => restore(item.key)}
								/>
							))}
						</ActivitySection>
					)}

					{view === "history" && historyVisible.length > 0 && (
						<ActivitySection label="History">
							{historyVisible.map((item) => {
								const index = visible.indexOf(item);
								return (
									<ActivityRow
										key={item.id}
										index={index}
										selected={index === selected}
										item={item}
										onSelect={() => setSelected(index)}
										onOpen={() => void openItem(item)}
										onRestore={() => restore(item.key)}
									/>
								);
							})}
						</ActivitySection>
					)}
				</div>
			</FadeScroll>
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
	index,
	selected,
	attention,
	onSelect,
	onOpen,
	onDismiss,
	onSnooze,
	onResolve,
	onRestore,
}: {
	item: ActivityItem;
	index: number;
	selected: boolean;
	attention?: boolean;
	onSelect: () => void;
	onOpen: () => void;
	onDismiss?: () => void;
	onSnooze?: () => void;
	onResolve?: () => void;
	onRestore?: () => void;
}) {
	const status = activityStatus(item);
	const snoozed = status === "snoozed";
	return (
		<div
			data-decision-index={index >= 0 ? index : undefined}
			className={`group flex w-full items-start gap-2 rounded-md px-1.5 py-1.5 transition-hover ${
				attention ? "bg-pi-surface-raised/60" : ""
			} ${selected ? "ring-1 ring-pi-accent/40" : ""} ${
				item.sessionFile ? "cursor-pointer hover:bg-pi-surface-raised" : "hover:bg-pi-surface-raised/50"
			}`}
			role={item.sessionFile ? "button" : undefined}
			tabIndex={item.sessionFile ? 0 : undefined}
			onMouseEnter={onSelect}
			onClick={() => {
				onSelect();
				if (item.sessionFile) onOpen();
			}}
			onKeyDown={(event) => {
				if (!item.sessionFile) return;
				if (event.key === "Enter" || event.key === " ") {
					event.preventDefault();
					onOpen();
				}
			}}
		>
			<span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_DOT[item.severity]}`} />
			<div className="min-w-0 flex-1">
				<div className="flex items-baseline gap-1.5">
					{item.running && <Loader2 className="h-3 w-3 shrink-0 animate-spin text-pi-text-muted" />}
					<span className="truncate text-xs font-medium text-pi-text">{item.title}</span>
					<span className="shrink-0 text-2xs text-pi-text-faint">
						{item.origin === "automation" ? "auto" : "human"}
					</span>
				</div>
				{item.detail && !item.running && (
					<div className="mt-0.5 line-clamp-2 text-2xs leading-relaxed text-pi-text-muted">{item.detail}</div>
				)}
				<div className="mt-0.5 flex items-center gap-1.5 text-2xs text-pi-text-faint">
					<span>{relativeTime(item.at)}</span>
					{snoozed && item.snoozedUntil && (
						<span className="inline-flex items-center gap-1">
							<Clock3 className="h-3 w-3" /> until {new Date(item.snoozedUntil).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
						</span>
					)}
					{status === "dismissed" && <span>dismissed</span>}
					{status === "resolved" && <span>resolved</span>}
					{item.action && <span>· {item.action.label}</span>}
				</div>
			</div>
			<div className="mt-0.5 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
				{onRestore ? (
					<button
						type="button"
						className="flex h-5 w-5 items-center justify-center rounded text-pi-text-faint hover:bg-pi-surface-raised hover:text-pi-text"
						aria-label="Restore decision"
						onClick={(event) => {
							event.stopPropagation();
							onRestore();
						}}
					>
						<RotateCcw className="h-3 w-3" />
					</button>
				) : (
					<>
						{onSnooze && (
							<button
								type="button"
								className="flex h-5 w-5 items-center justify-center rounded text-pi-text-faint hover:bg-pi-surface-raised hover:text-pi-text"
								aria-label="Snooze for one hour"
								onClick={(event) => {
									event.stopPropagation();
									onSnooze();
								}}
							>
								<Clock3 className="h-3 w-3" />
							</button>
						)}
						{onResolve && (
							<button
								type="button"
								className="flex h-5 w-5 items-center justify-center rounded text-pi-text-faint hover:bg-pi-surface-raised hover:text-pi-text"
								aria-label="Mark decision resolved"
								onClick={(event) => {
									event.stopPropagation();
									onResolve();
								}}
							>
								<Check className="h-3 w-3" />
							</button>
						)}
						{onDismiss && (
							<button
								type="button"
								className="flex h-5 w-5 items-center justify-center rounded text-pi-text-faint hover:bg-pi-surface-raised hover:text-pi-text"
								aria-label="Dismiss decision"
								onClick={(event) => {
									event.stopPropagation();
									onDismiss();
								}}
							>
								<X className="h-3 w-3" />
							</button>
						)}
					</>
				)}
				{item.sessionFile && (
					<Archive className="h-3 w-3 text-pi-text-faint/50" aria-hidden />
				)}
			</div>
		</div>
	);
}
