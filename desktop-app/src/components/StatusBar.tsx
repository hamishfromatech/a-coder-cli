import { useState, useRef, useEffect } from "react";
import {
	AlertCircle,
	Check,
	ChevronDown,
	Coins,
	Eye,
	Hash,
	Loader2,
	Lock,
	MessageSquare,
	RefreshCw,
	Shield,
	Timer,
	Wrench,
	Zap,
} from "lucide-react";
import * as rpc from "../lib/rpc";
import { useSessionStore } from "../stores/session-store";
import { useSettingsStore } from "../stores/settings-store";
import { useStatsStore } from "../stores/stats-store";
import type { PermissionMode } from "../lib/settings.types";

export interface StatusBarProps {
	projectPath: string | null;
	onReconnect: () => void;
}

const PERMISSION_MODES: PermissionMode[] = ["ask", "allow", "read-only", "auto"];

const MODE_META: Record<
	PermissionMode,
	{ label: string; description: string; icon: typeof Shield; color: string }
> = {
	ask: {
		label: "Ask first",
		description: "Ask for confirmation before every tool call.",
		icon: Shield,
		color: "text-pi-warning bg-pi-warning/15",
	},
	allow: {
		label: "Act freely",
		description: "Run all tool calls automatically.",
		icon: Zap,
		color: "text-pi-success bg-pi-success/15",
	},
	"read-only": {
		label: "Read only",
		description: "Only use read and inspect tools; block commands and edits.",
		icon: Eye,
		color: "text-pi-text-secondary bg-pi-surface-raised",
	},
	auto: {
		label: "Auto",
		description: "Use permission policies to decide what needs approval.",
		icon: Lock,
		color: "text-pi-accent bg-pi-accent-soft",
	},
};

export function StatusBar({ projectPath, onReconnect }: StatusBarProps) {
	const { status, error, isStreaming, thinkingLevel, permissionMode, contextUsage } = useSessionStore();
	const { stats } = useStatsStore();

	const projectName = projectPath
		? projectPath.split(/[/\\]/).filter(Boolean).at(-1) ?? projectPath
		: "No project";

	return (
		<div className="flex h-7 shrink-0 items-center justify-between gap-3 border-t border-pi-border bg-pi-surface/60 px-3 text-3xs backdrop-blur">
			{/* Left: project + thinking + permission */}
			<div className="flex min-w-0 items-center gap-1.5">
				<span
					className={`h-1.5 w-1.5 shrink-0 rounded-full shadow-[0_0_6px_var(--pi-${status === "error" ? "error" : status === "connecting" ? "warning" : "success"})] ${status === "error" ? "bg-pi-error" : status === "connecting" ? "bg-pi-warning" : "bg-pi-success"}`}
					aria-hidden
				/>
				<span
					className="truncate font-medium text-pi-text-secondary"
					title={projectPath ?? undefined}
				>
					{projectName}
				</span>
				{thinkingLevel && thinkingLevel !== "off" && (
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
				{status === "connected" && permissionMode && (
					<>
						<Sep />
						<PermissionModePicker mode={permissionMode} />
					</>
				)}
			</div>

			{/* Middle: context usage + stats */}
			<div className="flex shrink-0 items-center gap-1 font-mono pi-tabular text-pi-text-muted">
				{contextUsage && contextUsage.contextWindow > 0 && (
					<ContextUsageBar usage={contextUsage} />
				)}
				{stats && (
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

			{/* Right: status / streaming / error */}
			<div className="flex items-center gap-1.5">
				{isStreaming && (
					<div className="flex items-center gap-1 rounded bg-pi-accent-soft px-1.5 py-0.5 text-pi-accent">
						<span className="flex items-center gap-0.5">
							<span className="pi-dot h-1 w-1 rounded-full bg-pi-accent" />
							<span className="pi-dot h-1 w-1 rounded-full bg-pi-accent" />
							<span className="pi-dot h-1 w-1 rounded-full bg-pi-accent" />
						</span>
						<span className="font-medium uppercase tracking-wide">Streaming</span>
					</div>
				)}

				{status === "error" ? (
					<button
						onClick={() => void onReconnect()}
						className="group flex items-center gap-1.5 rounded bg-pi-error-soft px-2 py-0.5 text-pi-error transition-hover active-press hover:bg-pi-error hover:text-white"
						title="Click to reconnect" aria-label="Reconnect"
					>
						<AlertCircle className="h-3 w-3" />
						<span className="max-w-48 truncate font-medium">
							{error ?? "Engine error"}
						</span>
						<RefreshCw className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100" />
					</button>
				) : status === "connecting" ? (
					<div className="flex items-center gap-1.5 text-pi-text-muted">
						<Loader2 className="h-3 w-3 animate-spin" />
						<span className="font-medium uppercase tracking-wide">Connecting</span>
					</div>
				) : (
					<div className="flex items-center gap-1.5 text-pi-text-muted">
						<span className="font-medium uppercase tracking-wide">Ready</span>
					</div>
				)}
			</div>
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
	const { setPermissionMode: setSessionPermissionMode } = useSessionStore();
	const { setPermissionMode: savePermissionMode } = useSettingsStore();
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
			<button
				ref={triggerRef}
				onClick={() => setOpen((v) => !v)}
				className={`flex h-5 items-center gap-1 rounded px-1.5 py-0.5 font-medium transition-hover active-press focus-visible:shadow-focus focus-visible:outline-none ${current.color}`}
				title={current.description}
				aria-haspopup="listbox"
				aria-expanded={open}
			>
				<Icon className="h-3 w-3" />
				<span className="hidden sm:inline">{current.label}</span>
				<ChevronDown className={`h-3 w-3 transition-smooth ${open ? "rotate-180" : ""}`} />
			</button>

			{open && (
				<div
					ref={menuRef}
					role="listbox"
					className="absolute bottom-full left-0 z-50 mb-1.5 w-56 origin-bottom-left rounded-xl bg-pi-surface-overlay shadow-overlay overflow-hidden py-1"
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
								<div className={`mt-0.5 rounded p-1 ${meta.color}`}>
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
		<span className="flex items-center gap-1 rounded px-1.5 py-0.5">
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
