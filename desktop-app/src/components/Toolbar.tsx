import { ChevronLeft, ChevronRight, CircleStop, Copy, Cpu, FileDown, GitBranch, Plus, Sparkles, Brain } from "lucide-react";
import * as rpc from "../lib/rpc";
import { triggerHaptic } from "../lib/haptics";
import { useSessionStore } from "../stores/session-store";
import { Button } from "./ui/Button";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;

type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export interface ToolbarProps {
	onShowModelPicker: () => void;
	onShowMemory: () => void;
}

export function Toolbar({ onShowModelPicker, onShowMemory }: ToolbarProps) {
	const {
		model,
		thinkingLevel,
		isStreaming,
		isCompacting,
		setThinkingLevel,
		setModel,
		setIsCompacting,
	} = useSessionStore();

	const handleNewSession = async () => {
		triggerHaptic("crisp");
		try {
			await rpc.sendCommand({ type: "new_session" });
		} catch (e) {
			console.error(e);
		}
	};

	const handleCycleModel = async () => {
		triggerHaptic("selection");
		try {
			const res = (await rpc.sendCommand({ type: "cycle_model" })) as {
				model?: { provider: string; id: string; name?: string };
				thinkingLevel?: string;
				isScoped?: boolean;
			} | null;
			const next = res?.model;
			if (next) {
				setModel(next as never);
				if (res?.thinkingLevel) setThinkingLevel(res.thinkingLevel);
			}
		} catch (e) {
			console.error(e);
		}
	};

	const handleSetThinkingLevel = async (level: ThinkingLevel) => {
		triggerHaptic("selection");
		try {
			await rpc.sendCommand({ type: "set_thinking_level", level });
			setThinkingLevel(level);
		} catch (e) {
			console.error(e);
		}
	};

	const handleCycleThinking = async () => {
		triggerHaptic("selection");
		try {
			const res = (await rpc.sendCommand({ type: "cycle_thinking_level" })) as {
				level?: ThinkingLevel;
			} | null;
			if (res?.level) setThinkingLevel(res.level);
		} catch (e) {
			console.error(e);
		}
	};

	const handleCompact = async () => {
		triggerHaptic("crisp");
		try {
			setIsCompacting(true);
			await rpc.sendCommand({ type: "compact" });
		} catch (e) {
			console.error(e);
		} finally {
			setIsCompacting(false);
		}
	};

	const handleAbort = async () => {
		triggerHaptic("cancel");
		// Mark the turn as user-cancelled so agent_end doesn't play the cue.
		useSessionStore.getState().setAbortRequested(true);
		try {
			await rpc.sendCommand({ type: "abort" });
		} catch (e) {
			console.error(e);
		}
	};

	return (
		<div className="flex items-center gap-2">
			{/* New session — primary pill */}
			<Button
				variant="secondary"
				size="sm"
				icon={Plus}
				onClick={() => void handleNewSession()}
				title="New session (⌘N)"
				aria-label="New session"
			>
				New
			</Button>

			{/* Memory — cross-workspace notes */}
			<Button
				variant="secondary"
				size="sm"
				icon={Brain}
				onClick={() => {
					triggerHaptic("selection");
					onShowMemory();
				}}
				title="Memory"
				aria-label="Memory"
				className="text-pi-accent"
			>
				Memory
			</Button>

			{/* Model picker + cycle */}
			<div className="inline-flex h-7 items-stretch overflow-hidden rounded-md border border-pi-border bg-pi-surface-raised transition-smooth">
				<button
					onClick={onShowModelPicker}
					className="flex items-center gap-1.5 px-2.5 text-xs font-medium text-pi-text-secondary transition-hover active-press hover:bg-pi-surface-overlay hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
					title="Change model" aria-label="Change model"
				>
					<Cpu className="h-3.5 w-3.5 transition-smooth text-pi-accent" />
					<span className="max-w-44 truncate">
						{model?.name ?? "Select model"}
					</span>
				</button>
				<button
					onClick={() => void handleCycleModel()}
					className="flex w-7 items-center justify-center border-l border-pi-border text-pi-text-muted transition-hover active-press hover:bg-pi-surface-overlay hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
					title="Cycle model (Ctrl+P)" aria-label="Cycle model"
				>
					<ChevronRight className="h-3 w-3 transition-smooth" />
				</button>
			</div>

			{/* Thinking level — segmented */}
			<div className="flex h-7 items-center gap-0.5 rounded-md border border-pi-border bg-pi-surface-raised p-0.5 transition-smooth">
				<span className="px-1.5 text-3xs font-semibold uppercase tracking-wider text-pi-text-faint">
					Think
				</span>
				{THINKING_LEVELS.map((level) => {
					const active = (thinkingLevel ?? "off") === level;
					return (
						<button
							key={level}
							onClick={() => void handleSetThinkingLevel(level)}
							className={`h-5 rounded px-1.5 font-mono text-3xs uppercase tracking-wide transition-hover active-press focus-visible:shadow-focus focus-visible:outline-none ${
								active
									? "bg-pi-accent-soft text-pi-accent hover:bg-pi-accent-soft"
									: "text-pi-text-muted hover:bg-pi-surface-overlay hover:text-pi-text"
							}`}
							aria-pressed={active}
							title={`Thinking: ${level}`}
						>
							{level === "xhigh" ? "max" : level.slice(0, 3)}
						</button>
					);
				})}
				<button
					onClick={() => void handleCycleThinking()}
					className="ml-0.5 flex h-5 w-5 items-center justify-center rounded text-pi-text-muted transition-hover active-press hover:bg-pi-surface-overlay hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
					title="Cycle thinking level" aria-label="Cycle thinking level"
				>
					<ChevronLeft className="h-3 w-3 transition-smooth" />
				</button>
			</div>

			{/* Compact */}
			<Button
				variant="secondary"
				size="sm"
				icon={Sparkles}
				onClick={() => void handleCompact()}
				disabled={isCompacting || isStreaming}
				loading={isCompacting}
				title="Compact context (⌘K)"
				aria-label="Compact context"
			>
				{isCompacting ? "Compacting…" : "Compact"}
			</Button>

			{/* Abort — only when streaming */}
			{isStreaming && (
				<Button
					variant="danger"
					size="sm"
					icon={CircleStop}
					onClick={() => void handleAbort()}
					title="Abort generation (⌘.)"
					aria-label="Abort generation"
				>
					Abort
				</Button>
			)}
		</div>
	);
}

export function SessionActions() {
	const handleCopyLastReply = async () => {
		triggerHaptic("crisp");
		try {
			const res = await rpc.getLastAssistantText();
			if (res.text) {
				await navigator.clipboard.writeText(res.text).catch(() => {});
			}
		} catch (e) {
			console.error(e);
		}
	};

	const handleClone = async () => {
		triggerHaptic("crisp");
		try {
			await rpc.sendCommand({ type: "clone" });
		} catch (e) {
			console.error(e);
		}
	};

	const handleFork = async () => {
		triggerHaptic("crisp");
		try {
			const res = (await rpc.sendCommand({ type: "get_fork_messages" })) as {
				messages?: Array<{ entryId: string; text: string }>;
			};
			const messages = res?.messages ?? [];
			if (messages.length === 0) return;
			await rpc.sendCommand({
				type: "fork",
				entryId: messages[messages.length - 1].entryId,
			});
		} catch (e) {
			console.error(e);
		}
	};

	const handleExport = async () => {
		triggerHaptic("crisp");
		try {
			await rpc.sendCommand({ type: "export_html" });
		} catch (e) {
			console.error(e);
		}
	};

	return (
		<div className="flex flex-col gap-0.5">
			<ActionButton onClick={handleCopyLastReply} icon={Copy} label="Copy last reply" />
			<ActionButton onClick={handleClone} icon={Copy} label="Clone session" />
			<ActionButton onClick={handleFork} icon={GitBranch} label="Fork session" />
			<ActionButton onClick={handleExport} icon={FileDown} label="Export HTML" />
		</div>
	);
}

function ActionButton({
	onClick,
	icon: Icon,
	label,
}: {
	onClick: () => void;
	icon: typeof Copy;
	label: string;
}) {
	return (
		<button
			onClick={() => void onClick()}
			className="group flex h-7 items-center gap-2 rounded-md px-2.5 text-left text-xs text-pi-text-secondary transition-hover active-press hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
			title={label}
		>
			<Icon className="h-3.5 w-3.5 text-pi-text-muted transition-smooth group-hover:text-pi-text-secondary" />
			<span className="truncate">{label}</span>
		</button>
	);
}