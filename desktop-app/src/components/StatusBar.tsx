import { useState, useRef, useEffect, type ReactNode } from "react";
import {
	AlertCircle,
	BookOpen,
	Check,
	ChevronDown,
	Coins,
	Eye,
	Hand,
	Hash,
	Loader2,
	Lock,
	MessageSquare,
	RefreshCw,
	Shield,
	SquareArrowOutUpRight,
	Timer,
	Wrench,
	X,
	Zap,
} from "lucide-react";
import { Loader } from "./ui/Loader";
import { Tip } from "./ui/Tip";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import * as rpc from "../lib/rpc";
import type { BackgroundProcessRecord } from "../lib/rpc";
import { useSessionStore } from "../stores/session-store";
import { useSettingsStore } from "../stores/settings-store";
import { useUiStore } from "../stores/ui-store";
import { useStatsStore } from "../stores/stats-store";
import { killBackgroundProcess } from "../lib/rpc";
import type { PermissionMode } from "../lib/settings.types";
import { toast } from "../stores/toast-store";
import { backgroundRunningBash } from "../lib/bash-background";
import { Badge, type BadgeVariant } from "./ui/Badge";
import { useShallow } from "zustand/react/shallow";
import { ESCAPE_PRIORITY, isTopEscapeLayer, pushEscapeLayer } from "../lib/escape-layers";
import {
	readHiddenStatusItems,
	STATUS_BAR_ITEMS,
	type StatusBarItemId,
	writeHiddenStatusItems,
} from "../lib/statusbar-prefs";

export interface StatusBarProps {
	projectPath: string | null;
	onReconnect: () => void;
}

const PERMISSION_MODES: PermissionMode[] = ["ask", "allow", "read-only", "auto"];

const MODE_META: Record<
	PermissionMode,
	{ label: string; description: string; icon: typeof Shield; variant: BadgeVariant }
> = {
	ask: {
		label: "Ask first",
		description: "Ask for confirmation before every tool call.",
		icon: Shield,
		variant: "warning",
	},
	allow: {
		label: "Act freely",
		description: "Run all tool calls automatically.",
		icon: Zap,
		variant: "success",
	},
	"read-only": {
		label: "Read only",
		description: "Only use read and inspect tools; block commands and edits.",
		icon: Eye,
		variant: "muted",
	},
	auto: {
		label: "Auto",
		description: "Use permission policies to decide what needs approval.",
		icon: Lock,
		variant: "accent",
	},
};

export function StatusBar({ projectPath, onReconnect }: StatusBarProps) {
	const { status, error, isStreaming, isCompacting, thinkingLevel, permissionMode, planMode, contextUsage, streamingVerb, backgroundProcesses, setPlanMode: setPlanModeState } =
		useSessionStore(
			useShallow((s) => ({
				status: s.status,
				error: s.error,
				isStreaming: s.isStreaming,
				isCompacting: s.isCompacting,
				thinkingLevel: s.thinkingLevel,
				permissionMode: s.permissionMode,
				planMode: s.planMode,
				contextUsage: s.contextUsage,
				streamingVerb: s.streamingVerb,
				backgroundProcesses: s.backgroundProcesses,
				setPlanMode: s.setPlanMode,
			})),
		);
	const subAgents = useSessionStore((s) => s.subAgents);
	// Hermes-parity awaiting-input state: when the turn is parked on a tool
	// approval for THIS session, it is paused on the user, not working — the
	// streaming indicator stands down so the wait is not read as in-flight work.
	const sessionFile = useSessionStore((s) => s.sessionFile);
	const awaitingInput = useSessionStore((s) =>
		s.uiRequests.some(
			(r) =>
				(r.kind === "permission" || r.method === "confirm") &&
				(!r.sessionFile || r.sessionFile === sessionFile),
		),
	);
	const { stats } = useStatsStore();
	const simple = useUiStore((s) => s.interfaceMode === "simple");
	const [hidden, setHidden] = useState<ReadonlySet<StatusBarItemId>>(() => readHiddenStatusItems());
	const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
	const menuRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!menuAt) return;
		const unregister = pushEscapeLayer(ESCAPE_PRIORITY.contextMenu);
		const onDown = (event: MouseEvent) => {
			if (!menuRef.current?.contains(event.target as Node)) setMenuAt(null);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (event.defaultPrevented || !isTopEscapeLayer(ESCAPE_PRIORITY.contextMenu)) return;
			event.preventDefault();
			setMenuAt(null);
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			unregister();
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [menuAt]);

	const toggleItem = (id: StatusBarItemId) => {
		setHidden((previous) => {
			const next = new Set(previous);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			writeHiddenStatusItems(next);
			return next;
		});
	};

	const resetItems = () => {
		const next = new Set<StatusBarItemId>();
		writeHiddenStatusItems(next);
		setHidden(next);
	};

	const togglePlanMode = async () => {
		const next = !planMode;
		setPlanModeState(next); // optimistic; reverted on failure
		try {
			await rpc.setPlanMode(next);
			toast.success(next ? "Plan mode on" : "Plan mode off");
		} catch (e) {
			setPlanModeState(!next);
			toast.error("Failed to set plan mode", e instanceof Error ? e.message : String(e));
		}
	};

	const runningAgents = subAgents.filter((a) => a.status === "running");

	const projectName = projectPath
		? projectPath.split(/[/\\]/).filter(Boolean).at(-1) ?? projectPath
		: "No project";

	// The engine models cwd per runtime, so "change the folder" means switching
	// the workspace: App resumes that folder's latest session (or starts one).
	// The dialog is native, so this stays a one-click affordance in the status bar.
	const pickProject = async () => {
		const picked = await openDialog({ directory: true, multiple: false, title: "Choose a working folder" });
		if (typeof picked === "string" && picked) {
			window.dispatchEvent(new CustomEvent("a-coder:switch-project", { detail: { path: picked } }));
		}
	};

	return (
		<div
			onContextMenu={(event) => {
				event.preventDefault();
				setMenuAt({
					x: Math.max(8, Math.min(event.clientX, window.innerWidth - 240)),
					y: event.clientY,
				});
			}}
			className="relative flex h-7 shrink-0 items-center justify-between gap-3 border-t border-pi-border bg-pi-surface/60 px-3 text-3xs backdrop-blur"
		>
			{/* Left: project + thinking + permission */}
			<div className="flex min-w-0 items-center gap-1.5">
				<span
					className={`h-1.5 w-1.5 shrink-0 rounded-full shadow-[0_0_6px_var(--pi-${status === "error" ? "error" : status === "connecting" ? "warning" : "success"})] ${status === "error" ? "bg-pi-error" : status === "connecting" ? "bg-pi-warning" : "bg-pi-success"}`}
					aria-hidden
				/>
				<Tip content="Change working folder" placement="control">
					<button
						type="button"
						onClick={() => void pickProject()}
						className="flex min-w-0 items-center gap-1 rounded-pi-sm px-0.5 text-pi-text-secondary transition-hover hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
						aria-label="Change working folder"
					>
						<span className="truncate font-medium">{projectName}</span>
						<FolderOpen className="h-2.5 w-2.5 shrink-0 opacity-60" />
					</button>
				</Tip>
				{!simple && thinkingLevel && thinkingLevel !== "off" && !hidden.has("thinking") && (
					<>
						<Sep />
						<span className="flex items-center gap-1 text-pi-text-muted">
							<Timer className="h-3 w-3" />
							<span className="font-medium uppercase tracking-wide text-pi-text-secondary">
								{thinkingLevel}
							</span>
						</span>
					</>
				)}
				{status === "connected" && permissionMode && !hidden.has("permission") && (
					<>
						<Sep />
						<PermissionModePicker mode={permissionMode} />
					</>
				)}
				{!simple && planMode && !hidden.has("plan") && (
					<>
						<Sep />
						<PlanModeChip onToggle={() => void togglePlanMode()} />
					</>
				)}
				{!simple && runningAgents.length > 0 && !hidden.has("agents") && (
					<>
						<Sep />
						<span
							className="flex items-center gap-1 font-mono pi-tabular text-pi-accent"
							title={`${runningAgents.length} background sub-agent${runningAgents.length === 1 ? "" : "s"} running: ${runningAgents.map((a) => a.teammateName ?? a.agentType).join(", ")}`}
						>
							<Loader className="h-4 w-4" />
							<span className="font-medium">{runningAgents.length} agent{runningAgents.length === 1 ? "" : "s"}</span>
						</span>
					</>
				)}
			</div>

			{/* Middle: context usage + stats */}
			<div className="flex shrink-0 items-center gap-1 font-mono pi-tabular text-pi-text-muted">
				{!simple && contextUsage && contextUsage.contextWindow > 0 && !hidden.has("context") && (
					<ContextUsageBar usage={contextUsage} />
				)}
				{!simple && stats && !hidden.has("stats") && (
					<>
						<Stat icon={MessageSquare} label="Msgs" value={stats.totalMessages} />
						{stats.toolCalls > 0 && (
							<Stat icon={Wrench} label="Tools" value={stats.toolCalls} />
						)}
						<Stat icon={Hash} label="Tok" value={stats.tokens.total} />
						<Stat icon={Coins} label="$" value={stats.cost.toFixed(4)} />
					</>
				)}
			</div>

			{/* Right: status / streaming / compacting / error */}
			<div className="flex items-center gap-1.5">
				{backgroundProcesses.length > 0 && !hidden.has("processes") && (
					<BackgroundProcessesChip
						processes={backgroundProcesses}
						onBackground={() => void backgroundRunningBash()}
					/>
				)}
				{isCompacting && (
					<Tip content="Summarizing older messages to reclaim context window" placement="control">
						<div className="flex items-center gap-1 rounded-pi-sm bg-pi-warning/10 px-1.5 py-0.5 text-pi-warning">
							<Loader2 className="h-2.5 w-2.5 animate-spin" />
							<span className="font-medium uppercase tracking-wide">Compacting</span>
						</div>
					</Tip>
				)}
				{awaitingInput && (
					<Tip content="A tool is waiting for your approval" placement="control">
						<div className="flex items-center gap-1 rounded-pi-sm bg-pi-warning/10 px-1.5 py-0.5 text-pi-warning">
							<Hand className="h-2.5 w-2.5" />
							<span className="font-medium uppercase tracking-wide">Waiting for you</span>
						</div>
					</Tip>
				)}

				{isStreaming && !awaitingInput && (
					<div className="flex items-center gap-1 rounded-pi-sm bg-pi-accent-soft px-1.5 py-0.5 text-pi-accent">
						<span className="flex items-center gap-0.5">
							<span className="pi-dot h-1 w-1 rounded-full bg-pi-accent" />
							<span className="pi-dot h-1 w-1 rounded-full bg-pi-accent" />
							<span className="pi-dot h-1 w-1 rounded-full bg-pi-accent" />
						</span>
						<span className="font-medium uppercase tracking-wide">{streamingVerb}</span>
					</div>
				)}

				{status === "error" ? (
					<button
						onClick={() => void onReconnect()}
						className="group flex items-center gap-1.5 rounded-pi-sm bg-pi-error-soft px-2 py-0.5 text-pi-error transition-hover active-press hover:bg-pi-error hover:text-white"
aria-label="Reconnect"
					>
						<AlertCircle className="h-3 w-3" />
						<span className="max-w-48 truncate font-medium">
							{error ?? "Engine error"}
						</span>
						<RefreshCw className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
					</button>
				) : status === "connecting" ? (
					<div className="flex items-center gap-1.5 text-pi-text-muted">
						<Loader className="h-4 w-4" />
						<span className="font-medium uppercase tracking-wide">Connecting</span>
					</div>
				) : (
					<div className="flex items-center gap-1.5 text-pi-text-muted">
						<span className="font-medium uppercase tracking-wide">Ready</span>
					</div>
				)}
			</div>

			{menuAt && (
				<div
					ref={menuRef}
					role="menu"
					aria-label="Status bar items"
					className="fixed z-popover w-60 overflow-hidden rounded-pi-lg border border-pi-border bg-pi-surface-overlay py-1 shadow-overlay"
					style={{ left: menuAt.x, bottom: window.innerHeight - menuAt.y + 4 }}
				>
					<div className="px-2.5 py-1 text-3xs font-semibold uppercase tracking-[0.08em] text-pi-text-faint">
						Status bar items
					</div>
					{(simple ? STATUS_BAR_ITEMS.filter((item) => item.id === "permission") : STATUS_BAR_ITEMS).map((item) => {
						const visible = !hidden.has(item.id);
						return (
							<button
								key={item.id}
								type="button"
								role="menuitemcheckbox"
								aria-checked={visible}
								onClick={() => toggleItem(item.id)}
								className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-2xs text-pi-text-secondary transition-hover hover:bg-pi-surface-raised hover:text-pi-text"
							>
								<Check className={`h-3 w-3 shrink-0 ${visible ? "text-pi-accent" : "opacity-0"}`} />
								<span className="truncate">{item.label}</span>
							</button>
						);
					})}
					<div className="my-1 h-px bg-pi-border" role="separator" />
					<button
						type="button"
						role="menuitem"
						onClick={resetItems}
						className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-2xs text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text"
					>
						<span className="w-3 shrink-0" />
						Reset status bar
					</button>
				</div>
			)}
		</div>
	);
}

function ContextUsageBar({
	usage,
}: {
	usage: {
		tokens: number | null;
		contextWindow: number;
		percent: number | null;
	};
}) {
	const percent = usage.percent ?? 0;
	const tokens = usage.tokens ?? 0;
	const window = usage.contextWindow;
	const color =
		percent > 90 ? "bg-pi-error" : percent > 70 ? "bg-pi-warning" : "bg-pi-accent";
	return (
		<div className="mr-2 flex w-24 flex-col gap-0.5" title={`${tokens.toLocaleString()} / ${window.toLocaleString()} tokens`}>
			<div className="flex justify-between text-4xs text-pi-text-faint">
				<span>Context</span>
				<span>{Math.round(percent)}%</span>
			</div>
			<div className="h-1.5 w-full overflow-hidden rounded-full border border-pi-border bg-pi-surface-raised">
				<div
					className={`h-full transition-all ${color}`}
					style={{ width: `${Math.min(100, percent)}%` }}
				/>
			</div>
		</div>
	);
}

function PermissionModePicker({ mode }: { mode: PermissionMode }) {
	const [open, setOpen] = useState(false);
	const setSessionPermissionMode = useSessionStore((s) => s.setPermissionMode);
	const savePermissionMode = useSettingsStore((s) => s.setPermissionMode);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const menuRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) return;
		function onClickOutside(event: MouseEvent) {
			if (
				triggerRef.current?.contains(event.target as Node) ||
				menuRef.current?.contains(event.target as Node)
			) {
				return;
			}
			setOpen(false);
		}
		function onKey(event: KeyboardEvent) {
			if (event.key === "Escape") setOpen(false);
		}
		document.addEventListener("mousedown", onClickOutside);
		document.addEventListener("keydown", onKey);
		return () => {
			document.removeEventListener("mousedown", onClickOutside);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	const handleSelect = async (next: PermissionMode) => {
		setOpen(false);
		if (next === mode) return;
		setSessionPermissionMode(next);
		savePermissionMode(next);
		try {
			await rpc.setPermissionMode(next);
		} catch (e) {
			console.error("Failed to set permission mode", e);
		}
	};

	const current = MODE_META[mode];
	const Icon = current.icon;

	return (
		<div className="relative">
			<Badge
				ref={triggerRef as unknown as React.Ref<HTMLSpanElement>}
				variant={current.variant}
				size="sm"
				icon={Icon}
				className="cursor-pointer transition-hover active-press focus-visible:shadow-focus focus-visible:outline-none"
				onClick={() => setOpen((v) => !v)}

				aria-haspopup="listbox"
				aria-expanded={open}
				role="button"
				tabIndex={0}
			>
				<span className="hidden sm:inline">{current.label}</span>
				<ChevronDown className={`h-3 w-3 transition-smooth ${open ? "rotate-180" : ""}`} />
			</Badge>

			{open && (
				<div
					ref={menuRef}
					role="listbox"
					className="absolute bottom-full left-0 z-popover mb-1.5 w-56 origin-bottom-left rounded-pi-xl bg-pi-surface-overlay shadow-overlay overflow-hidden py-1"
				>
					{PERMISSION_MODES.map((m) => {
						const meta = MODE_META[m];
						const active = m === mode;
						const OptionIcon = meta.icon;
						return (
							<button
								key={m}
								onClick={() => void handleSelect(m)}
								role="option"
								aria-selected={active}
								className={`flex w-full items-start gap-2 px-2.5 py-2 text-left transition-hover focus-visible:shadow-focus focus-visible:outline-none ${active ? "bg-pi-surface-raised" : "hover:bg-pi-surface-raised"}`}
							>
								<div className={`mt-0.5 rounded-pi-sm p-1 ${meta.variant === "warning" ? "text-pi-warning bg-pi-warning/15" : meta.variant === "success" ? "text-pi-success bg-pi-success/15" : meta.variant === "accent" ? "text-pi-accent bg-pi-accent-soft" : "text-pi-text-secondary bg-pi-surface-raised"}`}>
									<OptionIcon className="h-3 w-3" />
								</div>
								<div className="flex-1">
									<div className="flex items-center justify-between text-2xs">
										<span className="font-semibold text-pi-text">
											{meta.label}
										</span>
										{active && <Check className="h-3 w-3 text-pi-accent" />}
									</div>
									<div className="mt-0.5 text-3xs leading-snug text-pi-text-muted">
										{meta.description}
									</div>
								</div>
							</button>
						);
					})}
				</div>
			)}
		</div>
	);
}

function Stat({
	icon: Icon,
	label,
	value,
}: {
	icon: typeof Coins;
	label: string;
	value: number | string;
}) {
	return (
		<span className="flex items-center gap-1 rounded-pi-sm px-1.5 py-0.5">
			<Icon className="h-3 w-3 text-pi-text-faint" />
			<span className="text-pi-text-faint">{label}</span>
			<span className="font-semibold text-pi-text-secondary">
				{typeof value === "number" ? value.toLocaleString() : value}
			</span>
		</span>
	);
}

function Sep() {
	return <span className="mx-1 h-3 w-px bg-pi-border" />;
}
function PlanModeChip({ onToggle }: { onToggle: () => void }) {
	return (
		<Tip content="Plan mode: the agent plans and you approve before it touches tools. Click to exit." placement="control">
			<Badge
				variant="accent"
				size="sm"
				icon={BookOpen}
				className="cursor-pointer transition-hover active-press"
				onClick={onToggle}
				role="button"
				aria-pressed
			>
				Plan
			</Badge>
		</Tip>
	);
}

const PROCESS_STATUS_META: Record<
	string,
	{ glyph: ReactNode; label: string; tone: string }
> = {
	running: { glyph: <Loader2 className="size-3 animate-spin text-pi-accent" />, label: "running", tone: "text-pi-accent" },
	done: { glyph: <Check className="size-3 text-pi-success" strokeWidth={2.5} />, label: "exited 0", tone: "text-pi-success" },
	error: { glyph: <AlertCircle className="size-3 text-pi-error" />, label: "failed", tone: "text-pi-error" },
	killed: { glyph: <X className="size-3 text-pi-text-muted" />, label: "killed", tone: "text-pi-text-muted" },
};

/** Status-bar chip + popover listing the engine's background bash processes. */
function BackgroundProcessesChip({
	processes,
	onBackground,
}: {
	processes: BackgroundProcessRecord[];
	onBackground: () => void;
}) {
	const [open, setOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!open) return;
		const unregister = pushEscapeLayer(ESCAPE_PRIORITY.contextMenu);
		const onDown = (event: MouseEvent) => {
			if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (event.defaultPrevented || !isTopEscapeLayer(ESCAPE_PRIORITY.contextMenu)) return;
			event.preventDefault();
			setOpen(false);
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			unregister();
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [open]);

	const running = processes.filter((p) => p.status === "running");

	const kill = async (processId: string) => {
		try {
			await killBackgroundProcess(processId);
		} catch (e) {
			toast.error("Kill failed", e instanceof Error ? e.message : String(e));
		}
	};

	const chipLabel = `${running.length} running`;
	return (
		<div ref={rootRef} className="relative">
			<Tip content="Background processes (Ctrl+B backgrounds a running command)" placement="control">
				<Badge
					variant={running.length > 0 ? "accent" : "muted"}
					size="sm"
					icon={SquareArrowOutUpRight}
					className="cursor-pointer transition-hover active-press"
					onClick={() => setOpen((v) => !v)}
					aria-haspopup="dialog"
					aria-expanded={open}
					role="button"
					tabIndex={0}
				>
					{running.length > 0 ? chipLabel : `${processes.length} finished`}
					<ChevronDown className={`h-3 w-3 transition-smooth ${open ? "rotate-180" : ""}`} />
				</Badge>
			</Tip>
			{open && (
				<div
					role="dialog"
					aria-label="Background processes"
					className="absolute bottom-full right-0 z-popover mb-1.5 flex max-h-80 w-[380px] max-w-[90vw] flex-col overflow-hidden rounded-pi-xl border border-pi-border bg-pi-surface-overlay shadow-overlay"
				>
					<div className="flex items-center justify-between border-b border-pi-border px-3 py-2">
						<span className="text-3xs font-semibold uppercase tracking-[0.08em] text-pi-text-faint">
							Background processes
						</span>
						<button
							type="button"
							onClick={onBackground}
							disabled={running.length > 0}
							title="Send the currently running foreground command to the background"
							className="flex cursor-pointer items-center gap-1 rounded-pi-sm px-1.5 py-0.5 text-3xs text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text disabled:cursor-default disabled:opacity-40"
						>
							<SquareArrowOutUpRight className="h-3 w-3" />
							Background now
						</button>
					</div>
					<div className="min-h-0 flex-1 overflow-y-auto py-1">
						{processes.length === 0 && (
							<div className="px-3 py-4 text-center text-2xs text-pi-text-muted">
								Nothing running in the background.
							</div>
						)}
						{processes.map((process) => {
							const meta = PROCESS_STATUS_META[process.status] ?? PROCESS_STATUS_META.done!;
							const tail = process.output.split("\n").filter(Boolean).at(-1) ?? "";
							return (
								<div
									key={process.id}
									className="group/process flex w-full items-start gap-2 px-3 py-1.5 transition-hover hover:bg-pi-surface-raised"
								>
									<span className="mt-1 shrink-0">{meta.glyph}</span>
									<div className="min-w-0 flex-1">
										<div className="flex items-baseline gap-2">
											<span className="truncate font-mono text-2xs text-pi-text-secondary">
												{process.command}
											</span>
											<span className={`ml-auto shrink-0 font-mono text-3xs ${meta.tone}`}>
												{process.status === "running"
													? formatElapsed(process.startedAt)
													: process.exitCode
														? `${meta.label} (${process.exitCode})`
														: meta.label}
											</span>
										</div>
										{tail && (
											<div className="mt-0.5 truncate font-mono text-3xs text-pi-text-faint" title={tail}>
												{tail}
											</div>
										)}
									</div>
									<button
										type="button"
										onClick={() => void kill(process.id)}
										aria-label={process.status === "running" ? "Kill process" : "Remove from list"}
										title={process.status === "running" ? "Kill" : "Remove"}
										className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-pi-text-faint opacity-0 transition-hover hover:bg-pi-error/10 hover:text-pi-error group-hover/process:opacity-100"
									>
										<X className="h-3 w-3" />
									</button>
								</div>
							);
						})}
					</div>
				</div>
			)}
		</div>
	);
}

function formatElapsed(startedAt: number): string {
	const seconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
	const minutes = Math.floor(seconds / 60);
	const hours = Math.floor(minutes / 60);
	if (hours > 0) return `${hours}h${String(minutes % 60).padStart(2, "0")}m`;
	return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}
