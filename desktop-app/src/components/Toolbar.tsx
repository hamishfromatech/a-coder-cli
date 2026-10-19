import {
	Brain,
	Copy,
	FileDown,
	GitBranch,
	Globe,
	MoreHorizontal,
	Plus,
	Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import * as rpc from "../lib/rpc";
import { triggerHaptic } from "../lib/haptics";
import { ESCAPE_PRIORITY, isTopEscapeLayer, pushEscapeLayer } from "../lib/escape-layers";
import { useSessionStore } from "../stores/session-store";
import { Button } from "./ui/Button";
import { Tip } from "./ui/Tip";
import { useShallow } from "zustand/react/shallow";

export interface ToolbarProps {
	onShowMemory: () => void;
	onToggleBrowser?: () => void;
	browserOpen?: boolean;
}

interface MenuItem {
	label: string;
	icon: typeof Copy;
	onSelect: () => void;
	disabled?: boolean;
}

/** Header actions only. Model and thinking are turn-scoped and live in the
 *  composer; everything occasional folds into one overflow menu. */
export function Toolbar({ onShowMemory, onToggleBrowser, browserOpen }: ToolbarProps) {
	const [menuOpen, setMenuOpen] = useState(false);
	const menuRef = useRef<HTMLDivElement | null>(null);
	const { isStreaming, isCompacting, setIsCompacting } = useSessionStore(
		useShallow((s) => ({
			isStreaming: s.isStreaming,
			isCompacting: s.isCompacting,
			setIsCompacting: s.setIsCompacting,
		})),
	);

	useEffect(() => {
		if (!menuOpen) return;
		const unregister = pushEscapeLayer(ESCAPE_PRIORITY.contextMenu);
		const onDown = (event: MouseEvent) => {
			if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (event.defaultPrevented || !isTopEscapeLayer(ESCAPE_PRIORITY.contextMenu)) return;
			event.preventDefault();
			setMenuOpen(false);
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			unregister();
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [menuOpen]);

	const run = (action: () => void | Promise<void>) => {
		setMenuOpen(false);
		void action();
	};

	const handleNewSession = async () => {
		triggerHaptic("crisp");
		try {
			await rpc.sendCommand({ type: "new_session" });
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

	const handleCopyLastReply = async () => {
		triggerHaptic("crisp");
		try {
			const res = await rpc.getLastAssistantText();
			if (res.text) await navigator.clipboard.writeText(res.text).catch(() => {});
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
			await rpc.sendCommand({ type: "fork", entryId: messages[messages.length - 1]!.entryId });
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

	const overflowItems: MenuItem[] = [
		{ label: "Memory", icon: Brain, onSelect: onShowMemory },
		{
			label: isCompacting ? "Compacting…" : "Compact context",
			icon: Sparkles,
			onSelect: () => void handleCompact(),
			disabled: isCompacting || isStreaming,
		},
		{ label: "Copy last reply", icon: Copy, onSelect: () => void handleCopyLastReply() },
		{ label: "Clone session", icon: Copy, onSelect: () => void handleClone() },
		{ label: "Fork session", icon: GitBranch, onSelect: () => void handleFork() },
		{ label: "Export HTML", icon: FileDown, onSelect: () => void handleExport() },
	];

	return (
		<div className="flex items-center gap-1">
			<Tip content="New session" placement="toolbar">
				<Button
					variant="ghost"
					size="icon-sm"
					icon={Plus}
					onClick={() => void handleNewSession()}
					aria-label="New session"
				/>
			</Tip>

			{onToggleBrowser && (
				<Tip content={browserOpen ? "Close browser panel" : "Open browser panel"} placement="toolbar">
					<Button
						variant="ghost"
						size="icon-sm"
						icon={Globe}
						className={browserOpen ? "bg-pi-accent-soft text-pi-accent hover:text-pi-accent" : ""}
						onClick={() => {
							triggerHaptic("selection");
							onToggleBrowser();
						}}
						aria-label={browserOpen ? "Close browser panel" : "Open browser panel"}
					/>
				</Tip>
			)}

			<div ref={menuRef} className="relative">
				<Tip content="More actions" placement="toolbar">
					<Button
						variant="ghost"
						size="icon-sm"
						icon={MoreHorizontal}
						onClick={() => {
							triggerHaptic("selection");
							setMenuOpen((open) => !open);
						}}
						aria-haspopup="menu"
						aria-expanded={menuOpen}
						aria-label="More actions"
					/>
				</Tip>
				{menuOpen && (
					<div
						role="menu"
						aria-label="Session actions"
						className="absolute left-0 top-full z-popover mt-1 w-52 overflow-hidden rounded-lg border border-pi-border bg-pi-surface-overlay py-1 shadow-overlay"
					>
						{overflowItems.map((item, index) => (
							<div key={item.label}>
								{index === 2 && <div className="my-1 h-px bg-pi-border" role="separator" />}
								<button
									type="button"
									role="menuitem"
									disabled={item.disabled}
									onClick={() => run(item.onSelect)}
									className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-2xs text-pi-text-secondary transition-hover hover:bg-pi-surface-raised hover:text-pi-text disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
								>
									<item.icon className="h-3.5 w-3.5 shrink-0 text-pi-text-muted" />
									<span className="truncate">{item.label}</span>
								</button>
							</div>
						))}
					</div>
				)}
			</div>
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

		>
			<Icon className="h-3.5 w-3.5 text-pi-text-muted transition-smooth group-hover:text-pi-text-secondary" />
			<span className="truncate">{label}</span>
		</button>
	);
}