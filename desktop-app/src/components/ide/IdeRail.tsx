/**
 * IDE activity rail: Explorer / Source Control / Terminal + exit back to the
 * chat layout.
 */

import { type ReactNode } from "react";
import { Folder, GitBranch, LogOut, Search, TerminalSquare } from "lucide-react";

import { cn } from "../../lib/cn.ts";
import { useIdeStore } from "../../stores/ide-store";
import { useUiStore } from "../../stores/ui-store";

export function IdeRail(): ReactNode {
	const sidebarTab = useIdeStore((s) => s.sidebarTab);
	const setSidebarTab = useIdeStore((s) => s.setSidebarTab);
	const terminalOpen = useIdeStore((s) => s.terminalOpen);
	const setTerminalOpen = useIdeStore((s) => s.setTerminalOpen);
	const setInterfaceMode = useUiStore((s) => s.setInterfaceMode);

	return (
		<aside className="flex w-11 shrink-0 flex-col items-center gap-1 border-r border-pi-border bg-pi-surface py-2">
			<RailButton
				active={sidebarTab === "explorer"}
				onClick={() => setSidebarTab(sidebarTab === "explorer" ? null : "explorer")}
				label="Explorer"
			>
				<Folder className="size-4" />
			</RailButton>
			<RailButton
				active={sidebarTab === "git"}
				onClick={() => setSidebarTab(sidebarTab === "git" ? null : "git")}
				label="Source control"
			>
				<GitBranch className="size-4" />
			</RailButton>
			<RailButton
				active={sidebarTab === "search"}
				onClick={() => setSidebarTab(sidebarTab === "search" ? null : "search")}
				label="Search"
			>
				<Search className="size-4" />
			</RailButton>
			<RailButton
				active={terminalOpen}
				onClick={() => setTerminalOpen(!terminalOpen)}
				label="Terminal"
			>
				<TerminalSquare className="size-4" />
			</RailButton>
			<RailButton
				active={false}
				onClick={() => setInterfaceMode("advanced")}
				label="Exit IDE (back to agent chat)"
				className="mt-auto"
			>
				<LogOut className="size-4" />
			</RailButton>
		</aside>
	);
}

interface RailButtonProps {
	active: boolean;
	onClick: () => void;
	label: string;
	className?: string;
	children: ReactNode;
}

function RailButton({ active, onClick, label, className, children }: RailButtonProps): ReactNode {
	return (
		<button
			onClick={onClick}
			aria-label={label}
			title={label}
			className={cn(
				"flex h-8 w-8 cursor-pointer items-center justify-center rounded-md transition-smooth",
				active
					? "bg-pi-accent-soft text-pi-accent"
					: "text-pi-text-faint hover:bg-pi-surface-raised hover:text-pi-text",
				className,
			)}
		>
			{children}
		</button>
	);
}