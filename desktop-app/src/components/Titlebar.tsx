import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
	ChevronDown,
	FileText,
	GitBranch,
	Minus,
	PanelLeft,
	PanelRight,
	Square,
	X,
} from "lucide-react";
import { useUiStore } from "../stores/ui-store";
import { useSessionStore } from "../stores/session-store";
import * as rpc from "../lib/rpc";
import { triggerHaptic } from "../lib/haptics";

const appWindow = getCurrentWindow();

type Platform = "mac" | "win" | "linux";

export function Titlebar() {
	const [isMaximized, setIsMaximized] = useState(false);
	const [editingName, setEditingName] = useState(false);
	const [nameDraft, setNameDraft] = useState("");
	const [platform] = useState<Platform>(() => {
		if (typeof navigator === "undefined") return "linux";
		if (/Mac/i.test(navigator.platform)) return "mac";
		if (/Win/i.test(navigator.platform)) return "win";
		return "linux";
	});

	const {
		leftSidebarOpen,
		rightSidebarOpen,
		toggleLeftSidebar,
		toggleRightSidebar,
		setRightSidebarTab,
		rightSidebarTab,
	} = useUiStore();
	const { sessionName, setSessionName, status } = useSessionStore();

	const beginEditName = () => {
		setNameDraft(sessionName ?? "");
		setEditingName(true);
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

	// Keep maximize state in sync so the button glyph flips between Square / Restore.
	useEffect(() => {
		let mounted = true;
		appWindow.isMaximized().then((v) => {
			if (mounted) setIsMaximized(v);
		});
		const unlisten = appWindow.onResized(async () => {
			setIsMaximized(await appWindow.isMaximized());
		});
		return () => {
			mounted = false;
			unlisten.then((fn) => fn());
		};
	}, []);

	const handleMinimize = () => void appWindow.minimize();
	const handleToggleMaximize = () => void appWindow.toggleMaximize();
	const handleClose = () => void appWindow.close();

	const isMac = platform === "mac";

	return (
		<div
			data-tauri-drag-region
			className="flex h-9 shrink-0 select-none items-center border-b border-pi-border bg-pi-surface/70 backdrop-blur"
		>
			{/* Left slot: traffic lights on mac, left sidebar toggle everywhere */}
			<div
				data-tauri-drag-region={false}
				className={`flex h-full shrink-0 items-center gap-1 ${
					isMac ? "w-auto pl-2.5" : "w-auto pl-1"
				}`}
			>
				{isMac && (
					<div className="flex items-center gap-2 pr-1.5">
						<TrafficLight color="close" onClick={handleClose} title="Close" />
						<TrafficLight color="minimize" onClick={handleMinimize} title="Minimize" />
						<TrafficLight color="maximize" onClick={handleToggleMaximize} title="Maximize" />
					</div>
				)}

				{!isMac && (
					<SidebarToggle
						onClick={toggleLeftSidebar}
						active={leftSidebarOpen}
						label="Toggle left sidebar"
					>
						<PanelLeft className="h-3.5 w-3.5 transition-smooth" />
					</SidebarToggle>
				)}
			</div>

			{/* Brand & session title (drag region). The title reads as a menu
			    trigger — click to rename, with a chevron signalling interactivity. */}
			<div
				data-tauri-drag-region
				className="flex h-full flex-1 items-center gap-2 px-2.5"
			>
				<span
					className={`h-1.5 w-1.5 shrink-0 rounded-full ${status === "error" ? "bg-pi-error" : status === "connecting" ? "bg-pi-warning" : "bg-pi-success"}`}
					aria-hidden
				/>
				<div className="flex h-5 w-5 items-center justify-center rounded-md bg-pi-accent-soft text-pi-accent transition-smooth">
					<PanelLeft className="h-3 w-3" />
				</div>
				<div className="flex items-center gap-1.5 truncate text-[12px]">
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
							className="w-48 rounded-md border border-pi-border bg-pi-surface-raised px-1.5 py-0.5 text-[12px] text-pi-text transition-smooth focus:shadow-focus focus:outline-none"
						/>
					) : (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								beginEditName();
							}}
							onDoubleClick={(e) => {
								e.stopPropagation();
								beginEditName();
							}}
							title="Click to rename session"
							aria-label="Rename session"
							className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-pi-text-muted transition-hover active-press hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
						>
							<span className="truncate">{sessionName || "Untitled session"}</span>
							<ChevronDown className="h-3 w-3 shrink-0 text-pi-text-faint transition-smooth" />
						</button>
					)}
				</div>
			</div>

			{/* Center spacer */}
			<div data-tauri-drag-region className="flex-1" />

			{/* Right slot: right sidebar controls + Windows/Linux window buttons */}
			<div
				data-tauri-drag-region={false}
				className="flex h-full shrink-0 items-center gap-0.5 px-1.5"
			>
				{isMac && (
					<SidebarToggle
						onClick={toggleLeftSidebar}
						active={leftSidebarOpen}
						label="Toggle left sidebar"
					>
						<PanelLeft className="h-3.5 w-3.5 transition-smooth" />
					</SidebarToggle>
				)}
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
						className={`flex h-7 w-7 items-center justify-center rounded-md text-pi-text-muted transition-hover active-press focus-visible:shadow-focus focus-visible:outline-none ${
							rightSidebarOpen && rightSidebarTab === tab
								? "bg-pi-accent-soft text-pi-accent"
								: "hover:bg-pi-surface-raised hover:text-pi-text"
						}`}
						title={label}
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

				{!isMac && (
					<div className="ml-1 flex items-center">
						<div className="mx-1 h-4 w-px bg-pi-border" />
						<WindowButton onClick={handleMinimize} title="Minimize">
							<Minus className="h-3 w-3 transition-smooth" />
						</WindowButton>
						<WindowButton onClick={handleToggleMaximize} title={isMaximized ? "Restore" : "Maximize"}>
							{isMaximized ? (
								<Square className="h-2.5 w-2.5 transition-smooth" />
							) : (
								<Square className="h-3 w-3 transition-smooth" />
							)}
						</WindowButton>
						<WindowButton
							onClick={handleClose}
							title="Close"
							className="hover:bg-pi-error hover:text-white"
						>
							<X className="h-3 w-3 transition-smooth" />
						</WindowButton>
					</div>
				)}
			</div>
		</div>
	);
}

function TrafficLight({
	color,
	onClick,
	title,
}: {
	color: "close" | "minimize" | "maximize";
	onClick: () => void;
	title: string;
}) {
	const colorClass =
		color === "close"
			? "bg-[#ff5f57] hover:bg-[#ff5f57]/90"
			: color === "minimize"
				? "bg-[#febc2e] hover:bg-[#febc2e]/90"
				: "bg-[#28c840] hover:bg-[#28c840]/90";

	const icon =
		color === "close" ? (
			<X className="h-2.5 w-2.5 text-black/80 opacity-0 group-hover:opacity-100" strokeWidth={2.5} />
		) : color === "minimize" ? (
			<Minus className="h-2.5 w-2.5 text-black/80 opacity-0 group-hover:opacity-100" strokeWidth={2.5} />
		) : (
			<Square className="h-2 w-2 text-black/80 opacity-0 group-hover:opacity-100" strokeWidth={2.5} />
		);

	return (
		<button
			onClick={(e) => {
				e.stopPropagation();
				onClick();
			}}
			onMouseDown={(e) => e.stopPropagation()}
			title={title}
			aria-label={title}
			className={`group relative flex h-4 w-4 items-center justify-center rounded-full transition-smooth`}
		>
			<span className={`absolute inset-1.5 rounded-full ${colorClass}`} />
			<span className="relative z-10">{icon}</span>
		</button>
	);
}

function WindowButton({
	children,
	onClick,
	title,
	className = "",
}: {
	children: React.ReactNode;
	onClick: () => void;
	title: string;
	className?: string;
}) {
	return (
		<button
			onClick={(e) => {
				e.stopPropagation();
				onClick();
			}}
			onMouseDown={(e) => e.stopPropagation()}
			title={title}
			aria-label={title}
			className={`group flex h-7 w-10 items-center justify-center text-pi-text-secondary transition-hover active-press hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none ${className}`}
		>
			{children}
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
			title={label}
			aria-label={label}
			className={`flex h-7 w-7 items-center justify-center rounded-md text-pi-text-muted transition-hover active-press focus-visible:shadow-focus focus-visible:outline-none ${
				active
					? "bg-pi-surface-raised text-pi-text"
					: "hover:bg-pi-surface-raised hover:text-pi-text"
			}`}
		>
			{children}
		</button>
	);
}