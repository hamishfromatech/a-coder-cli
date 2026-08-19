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
import { triggerHaptic } from "../lib/haptics";

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

	// Native window decorations are enabled in tauri.conf.json, so the OS
	// titlebar provides drag, minimize, maximize/restore, and close. This
	// component is now a compact toolbar rather than a second titlebar.
	return (
		<div className="flex h-9 shrink-0 select-none items-center border-b border-pi-border bg-pi-surface/70 backdrop-blur">
			{/* Left slot: left sidebar toggle. */}
			<div className="flex h-full shrink-0 items-center gap-1 pl-1">
				<SidebarToggle
					onClick={toggleLeftSidebar}
					active={leftSidebarOpen}
					label="Toggle left sidebar"
				>
					<PanelLeft className="h-3.5 w-3.5 transition-smooth" />
				</SidebarToggle>
			</div>

			{/* Brand & session title. */}
			<div className="flex h-full flex-1 items-center gap-2 px-2.5">
				<span
					className={`h-1.5 w-1.5 shrink-0 rounded-full ${status === "error" ? "bg-pi-error" : status === "connecting" ? "bg-pi-warning" : "bg-pi-success"}`}
					aria-hidden
				/>
				<div className="flex h-5 w-5 items-center justify-center rounded-md bg-pi-accent-soft text-pi-accent transition-smooth">
					<PanelLeft className="h-3 w-3" />
				</div>
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
			<div className="flex-1" />

			{/* Right slot: right sidebar controls. */}
			<div className="flex h-full shrink-0 items-center gap-0.5 px-1.5">
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
			</div>
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