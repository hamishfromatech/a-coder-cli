import { useState } from "react";
import {
	ChevronDown,
	FileText,
	GitBranch,
	PanelLeft,
	PanelRight,
} from "lucide-react";
import { useUiStore } from "../stores/ui-store";
import { useSessionStore } from "../stores/session-store";
import * as rpc from "../lib/rpc";
import { isMacOS } from "../lib/platform";
import { triggerHaptic } from "../lib/haptics";
import { BrandMark } from "./ui/BrandMark";
import { WindowControls } from "./WindowControls";

export function Titlebar() {
	const [editingName, setEditingName] = useState(false);
	const [nameDraft, setNameDraft] = useState("");

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
			{/* Left slot: (macOS traffic lights) + left sidebar toggle. */}
			<div
				data-tauri-drag-region
				className={`flex h-full shrink-0 items-center gap-1 ${isMacOS ? "pl-[72px]" : "pl-1"}`}
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
							className="w-48 rounded-md border border-pi-border bg-pi-surface-raised px-1.5 py-0.5 text-xs text-pi-text transition-smooth focus:shadow-focus focus:outline-none"
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
							aria-label="Rename session"
							className="flex cursor-pointer items-center gap-1 rounded-md px-1.5 py-0.5 text-pi-text-muted transition-hover active-press hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
						>
							<span className="truncate">{sessionName || "Untitled session"}</span>
							<ChevronDown className="h-3 w-3 shrink-0 text-pi-text-faint transition-smooth" />
						</button>
					)}
				</div>
			</div>

			{/* Center spacer */}
			<div data-tauri-drag-region className="flex-1" />

			{/* Right slot: right sidebar controls. */}
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
						className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-pi-text-muted transition-hover active-press focus-visible:shadow-focus focus-visible:outline-none ${
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
			</div>

			{/* Window controls: flush at the top-right edge (non-macOS). */}
			{!isMacOS && <WindowControls />}
		</div>
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
			className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-pi-text-muted transition-hover active-press focus-visible:shadow-focus focus-visible:outline-none ${
				active
					? "bg-pi-surface-raised text-pi-text"
					: "hover:bg-pi-surface-raised hover:text-pi-text"
			}`}
		>
			{children}
		</button>
	);
}
