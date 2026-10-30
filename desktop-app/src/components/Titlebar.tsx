import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
	ChevronDown,
	Code2,
	Copy,
	FileDown,
	FileText,
	GitBranch,
	PanelLeft,
	PanelRight,
	Pencil,
	PictureInPicture2,
	Pin,
	PinOff,
	Trash2,
} from "lucide-react";
import { useUiStore } from "../stores/ui-store";
import { useSessionStore } from "../stores/session-store";
import * as rpc from "../lib/rpc";
import { isMacOS } from "../lib/platform";
import { triggerHaptic } from "../lib/haptics";
import { ESCAPE_PRIORITY, isTopEscapeLayer, pushEscapeLayer } from "../lib/escape-layers";
import { BrandMark } from "./ui/BrandMark";
import { WindowControls } from "./WindowControls";
import { openHud } from "../lib/hud";
import { readPinnedSessions, togglePin } from "../lib/session-pins";
import { confirm } from "../stores/confirm-store";
import { toast } from "../stores/toast-store";

export function Titlebar() {
	const [editingName, setEditingName] = useState(false);
	const [nameDraft, setNameDraft] = useState("");
	const [titleMenu, setTitleMenu] = useState<{ top: number; left: number } | null>(null);
	const [pinned, setPinned] = useState(false);
	const titleMenuRef = useRef<HTMLDivElement | null>(null);

	// While the inline rename is open, Esc belongs to the rename (cancel),
	// not to lower-priority window handlers (engine stop).
	useEffect(() => {
		if (!editingName) return;
		return pushEscapeLayer(ESCAPE_PRIORITY.titlebarEdit);
	}, [editingName]);

	const {
		leftSidebarOpen,
		rightSidebarOpen,
		toggleLeftSidebar,
		toggleRightSidebar,
		setRightSidebarTab,
		rightSidebarTab,
		interfaceMode,
		setInterfaceMode,
	} = useUiStore();
	const simple = interfaceMode === "simple";
	const ideMode = interfaceMode === "ide";
	const sessionName = useSessionStore((s) => s.sessionName);
	const setSessionName = useSessionStore((s) => s.setSessionName);
	const sessionFile = useSessionStore((s) => s.sessionFile);
	const status = useSessionStore((s) => s.status);

	useEffect(() => {
		if (!titleMenu) return;
		const unregister = pushEscapeLayer(ESCAPE_PRIORITY.contextMenu);
		const onDown = (event: MouseEvent) => {
			if (!titleMenuRef.current?.contains(event.target as Node)) setTitleMenu(null);
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape") return;
			if (event.defaultPrevented || !isTopEscapeLayer(ESCAPE_PRIORITY.contextMenu)) return;
			event.preventDefault();
			setTitleMenu(null);
		};
		document.addEventListener("mousedown", onDown);
		document.addEventListener("keydown", onKey);
		return () => {
			unregister();
			document.removeEventListener("mousedown", onDown);
			document.removeEventListener("keydown", onKey);
		};
	}, [titleMenu]);

	const beginEditName = () => {
		setNameDraft(sessionName ?? "");
		setEditingName(true);
	};

	const openTitleMenu = (element: HTMLElement) => {
		const rect = element.getBoundingClientRect();
		setPinned(Boolean(sessionFile && readPinnedSessions().includes(sessionFile)));
		setTitleMenu({
			top: rect.bottom + 4,
			left: Math.max(8, Math.min(rect.left, window.innerWidth - 208)),
		});
	};

	const copyLastReply = async () => {
		setTitleMenu(null);
		try {
			const result = await rpc.getLastAssistantText();
			if (result.text) await navigator.clipboard.writeText(result.text).catch(() => {});
		} catch (e) {
			toast.error("Failed to copy reply", e instanceof Error ? e.message : String(e));
		}
	};

	const cloneSession = async () => {
		setTitleMenu(null);
		try {
			await rpc.sendCommand({ type: "clone" });
		} catch (e) {
			toast.error("Failed to clone session", e instanceof Error ? e.message : String(e));
		}
	};

	const forkSession = async () => {
		setTitleMenu(null);
		try {
			const res = (await rpc.sendCommand({ type: "get_fork_messages" })) as {
				messages?: Array<{ entryId: string; text: string }>;
			};
			const messages = res?.messages ?? [];
			if (messages.length === 0) return;
			await rpc.sendCommand({ type: "fork", entryId: messages[messages.length - 1]!.entryId });
		} catch (e) {
			toast.error("Failed to fork session", e instanceof Error ? e.message : String(e));
		}
	};

	const exportSession = async () => {
		setTitleMenu(null);
		try {
			await rpc.sendCommand({ type: "export_html" });
		} catch (e) {
			toast.error("Failed to export session", e instanceof Error ? e.message : String(e));
		}
	};

	const togglePinned = () => {
		if (!sessionFile) return;
		setPinned(togglePin(sessionFile).includes(sessionFile));
		setTitleMenu(null);
	};

	const deleteSession = () => {
		setTitleMenu(null);
		if (!sessionFile) return;
		void confirm({
			title: "Delete session?",
			message: "This session is moved to the sessions trash folder. You can restore the file from there.",
			confirmLabel: "Delete",
			danger: true,
			onConfirm: async () => {
				try {
					// The engine refuses to delete the active session. Start a fresh
					// one first, then remove the old file.
					await rpc.sendCommand({ type: "new_session" });
					await rpc.sendCommand({ type: "delete_session", sessionPath: sessionFile });
					toast.success("Session deleted", "Moved to the sessions trash folder.");
				} catch (e) {
					toast.error("Failed to delete session", e instanceof Error ? e.message : String(e));
				}
			},
		});
	};
	const commitName = async () => {
		const trimmed = nameDraft.trim();
		setEditingName(false);
		if (!trimmed || trimmed === sessionName) return;
		try {
			await rpc.setSessionName(trimmed);
			setSessionName(trimmed);
		} catch (e) {
			console.error(e);
		}
	};

	// Frameless window: this bar is the only titlebar. The root element and
	// its empty wrappers carry data-tauri-drag-region (drag + double-click
	// maximize, handled by Tauri's injected script); buttons and the session
	// name control stay interactive. macOS keeps native overlay traffic
	// lights (tauri.macos.conf.json), so the left slot reserves space for
	// them; Windows/Linux render custom controls flush at the right edge.
	return (
		<div
			data-tauri-drag-region
			className="flex h-9 shrink-0 select-none items-center border-b border-pi-border bg-pi-surface/70 backdrop-blur"
		>
			{/* Left slot: (macOS traffic lights) + left sidebar toggle. macOS 26's
				traffic lights are ~14pt buttons with ~23pt spacing: the cluster spans
				16 + 2×23 + 14 = 76px from the configured x:16 inset, so the slot must
				clear 76px plus breathing room. */}
			<div
				data-tauri-drag-region
				className={`flex h-full shrink-0 items-center gap-1 ${isMacOS ? "pl-[96px]" : "pl-1"}`}
			>
				<SidebarToggle
					onClick={toggleLeftSidebar}
					active={leftSidebarOpen}
					label="Toggle left sidebar"
				>
					<PanelLeft className="h-3.5 w-3.5 transition-smooth" />
				</SidebarToggle>
			</div>

			{/* Brand & session title. */}
			<div data-tauri-drag-region className="flex h-full flex-1 items-center gap-2 px-2.5">
				<span
					className={`h-1.5 w-1.5 shrink-0 rounded-full ${status === "error" ? "bg-pi-error" : status === "connecting" ? "bg-pi-warning" : "bg-pi-success"}`}
					aria-hidden
					style={{ pointerEvents: "none" }}
				/>
				<span className="shrink-0" style={{ pointerEvents: "none" }}>
					<BrandMark className="h-5 w-5" />
				</span>
				<div className="flex items-center gap-1.5 truncate text-xs">
					<span className="font-semibold tracking-tight text-pi-text">A-Coder</span>
					{editingName ? (
						<input
							autoFocus
							value={nameDraft}
							onChange={(e) => setNameDraft(e.target.value)}
							onBlur={() => void commitName()}
							onKeyDown={(e) => {
								if (e.key === "Enter") {
									e.preventDefault();
									void commitName();
								} else if (e.key === "Escape") {
									e.preventDefault();
									setEditingName(false);
								}
							}}
							placeholder="Untitled session"
							className="w-48 rounded-pi-md border border-pi-border bg-pi-surface-raised px-1.5 py-0.5 text-xs text-pi-text transition-smooth focus:shadow-focus focus:outline-none"
						/>
					) : (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								openTitleMenu(e.currentTarget);
							}}
							aria-label="Session actions"
							aria-haspopup="menu"
							aria-expanded={Boolean(titleMenu)}
							className="flex cursor-pointer items-center gap-1 rounded-pi-md px-1.5 py-0.5 text-pi-text-muted transition-hover active-press hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
						>
							<span className="truncate">{sessionName || "Untitled session"}</span>
							<ChevronDown className="h-3 w-3 shrink-0 text-pi-text-faint transition-smooth" />
						</button>
					)}
				</div>
			</div>

			{/* Center spacer */}
			<div data-tauri-drag-region className="flex-1" />

			{/* Right slot: right sidebar controls. Simple mode rests them out of
			    the chrome; the command palette still opens every pane. */}
			{/* IDE workspace toggle: one click into the editor surface (visible
			    in every interface mode; the palette and rail stay secondary). */}
			<div className="flex h-full shrink-0 items-center gap-0.5 pl-1">
				<button
					onClick={() => {
						triggerHaptic("selection");
						setInterfaceMode(ideMode ? "advanced" : "ide");
					}}
					className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-pi-md transition-hover active-press focus-visible:shadow-focus focus-visible:outline-none ${
						ideMode ? "bg-pi-accent-soft text-pi-accent" : "text-pi-text-muted hover:bg-pi-surface-raised hover:text-pi-text"
					}`}
					aria-label={ideMode ? "Back to agent chat" : "Open IDE workspace"}
					title={ideMode ? "Back to agent chat" : "Open IDE workspace (code editor + terminal)"}
				>
					<Code2 className="h-3.5 w-3.5 transition-smooth" />
				</button>
			</div>
			{!simple && (
				<div data-tauri-drag-region className="flex h-full shrink-0 items-center gap-0.5 px-1.5">
					{(
						[
							{ tab: "files", label: "Files", icon: FileText },
							{ tab: "git", label: "Git changes", icon: GitBranch },
						] as const
					).map(({ tab, label, icon: Icon }) => (
						<button
							key={tab}
							onClick={() => {
								triggerHaptic("selection");
								if (rightSidebarTab === tab && rightSidebarOpen) {
									toggleRightSidebar();
								} else {
									setRightSidebarTab(tab);
								}
							}}
							className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-pi-md text-pi-text-muted transition-hover active-press focus-visible:shadow-focus focus-visible:outline-none ${
								rightSidebarOpen && rightSidebarTab === tab
									? "bg-pi-accent-soft text-pi-accent"
									: "hover:bg-pi-surface-raised hover:text-pi-text"
							}`}
							aria-label={label}
						>
							<Icon className="h-3.5 w-3.5 transition-smooth" />
						</button>
					))}

					<SidebarToggle
						onClick={toggleRightSidebar}
						active={rightSidebarOpen}
						label="Toggle right sidebar"
					>
						<PanelRight className="h-3.5 w-3.5 transition-smooth" />
					</SidebarToggle>

					<SidebarToggle
						onClick={() => void openHud()}
						active={false}
						label="Open HUD floating chat"
					>
						<PictureInPicture2 className="h-3.5 w-3.5 transition-smooth" />
					</SidebarToggle>
				</div>
			)}

			{/* Window controls: flush at the top-right edge (non-macOS). */}
			{!isMacOS && <WindowControls />}

			{titleMenu &&
				createPortal(
					<div
						ref={titleMenuRef}
						role="menu"
						aria-label="Session actions"
						style={{
							position: "fixed",
							top: titleMenu.top,
							left: titleMenu.left,
							width: 200,
							zIndex: 80,
						}}
						className="rounded-pi-md border border-pi-border bg-pi-surface-overlay p-1 shadow-overlay backdrop-blur"
					>
						<TitleMenuItem icon={Pencil} label="Rename" onClick={() => { setTitleMenu(null); beginEditName(); }} />
						<TitleMenuItem
							icon={pinned ? PinOff : Pin}
							label={pinned ? "Unpin session" : "Pin to top"}
							onClick={togglePinned}
						/>
						<div className="my-1 h-px bg-pi-border" role="separator" />
						<TitleMenuItem icon={Copy} label="Copy last reply" onClick={() => void copyLastReply()} />
						<TitleMenuItem icon={Copy} label="Clone session" onClick={() => void cloneSession()} />
						<TitleMenuItem icon={GitBranch} label="Fork session" onClick={() => void forkSession()} />
						<TitleMenuItem icon={FileDown} label="Export HTML" onClick={() => void exportSession()} />
						<div className="my-1 h-px bg-pi-border" role="separator" />
						<TitleMenuItem icon={Trash2} label="Delete session" onClick={deleteSession} danger />
					</div>,
					document.body,
				)}
		</div>
	);
}

function TitleMenuItem({
	icon: Icon,
	label,
	onClick,
	danger = false,
}: {
	icon: typeof Copy;
	label: string;
	onClick: () => void;
	danger?: boolean;
}) {
	return (
		<button
			type="button"
			role="menuitem"
			onClick={onClick}
			className={`flex w-full items-center gap-2 rounded-pi-sm px-2 py-1.5 text-left text-2xs transition-hover focus-visible:bg-pi-surface-raised focus-visible:outline-none ${
				danger
					? "text-pi-text-muted hover:bg-pi-error-soft hover:text-pi-error"
					: "text-pi-text hover:bg-pi-surface-raised"
			}`}
		>
			<Icon className="h-3 w-3 shrink-0" />
			{label}
		</button>
	);
}

function SidebarToggle({
	children,
	onClick,
	active,
	label,
}: {
	children: React.ReactNode;
	onClick: () => void;
	active: boolean;
	label: string;
}) {
	return (
		<button
			onClick={() => {
				triggerHaptic("selection");
				onClick();
			}}
			aria-label={label}
			className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-pi-md text-pi-text-muted transition-hover active-press focus-visible:shadow-focus focus-visible:outline-none ${
				active
					? "bg-pi-surface-raised text-pi-text"
					: "hover:bg-pi-surface-raised hover:text-pi-text"
			}`}
		>
			{children}
		</button>
	);
}
