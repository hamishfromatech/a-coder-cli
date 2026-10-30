/**
 * IDE workspace mode: activity rail + sidebar (explorer / source control) +
 * editor group + terminal, with resizable panes sized from the ide store.
 * A VS Code-shaped shell around the same engine and design system — not the
 * workbench: a lean, opinionated surface for folder-bound work.
 */

import { type ReactNode, useEffect, useState } from "react";
import { GitBranch } from "lucide-react";

import { EditorGroup } from "./EditorGroup";
import { ExplorerTree } from "./ExplorerTree";
import { GitPanel } from "./GitPanel";
import { IdeRail } from "./IdeRail";
import { IdeTerminal } from "./IdeTerminal";
import { QuickOpen } from "./QuickOpen";
import { SearchPanel } from "./SearchPanel";
import { clampSize, ResizeHandle } from "./ResizeHandle";
import { gitStatus, type GitStatus } from "../../lib/rpc.ts";
import { fileInfo } from "../../lib/rpc.ts";
import { useIdeStore } from "../../stores/ide-store";

interface IdeWorkspaceProps {
	/** Absolute workspace directory (project path). */
	projectPath: string;
	/** Session's cwd override, if the active session has one. */
	cwd?: string;
}

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 520;
const TERMINAL_MIN = 96;
const TERMINAL_MAX = 640;

export function IdeWorkspace({ projectPath, cwd }: IdeWorkspaceProps): ReactNode {
	const sidebarTab = useIdeStore((s) => s.sidebarTab);
	const sidebarWidth = useIdeStore((s) => s.sidebarWidth);
	const setSidebarWidth = useIdeStore((s) => s.setSidebarWidth);
	const terminalOpen = useIdeStore((s) => s.terminalOpen);
	const setTerminalOpen = useIdeStore((s) => s.setTerminalOpen);
	const terminalHeight = useIdeStore((s) => s.terminalHeight);
	const setTerminalHeight = useIdeStore((s) => s.setTerminalHeight);
	const setSidebarTab = useIdeStore((s) => s.setSidebarTab);

	const [quickOpenOpen, setQuickOpenOpen] = useState(false);
	const [branch, setBranch] = useState<GitStatus | null>(null);

	const workspace = cwd || projectPath;

	// ⌘P quick open; Ctrl+` terminal toggle (Ctrl — ⌘` is a macOS native).
	// Capture phase + stopImmediatePropagation: in IDE mode these keys belong
	// to the IDE (quick open wins over the app-wide model-picker binding).
	useEffect(() => {
		const onKey = (event: KeyboardEvent): void => {
			if (event.metaKey && !event.shiftKey && !event.altKey && event.key.toLowerCase() === "p") {
				event.preventDefault();
				event.stopImmediatePropagation();
				setQuickOpenOpen(true);
			} else if (event.ctrlKey && event.code === "Backquote") {
				event.preventDefault();
				event.stopImmediatePropagation();
				setTerminalOpen(!useIdeStore.getState().terminalOpen);
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [setTerminalOpen]);

	// Status-bar branch chip: loads with the workspace; refreshes when the
	// agent (or git ops elsewhere) touch files.
	useEffect(() => {
		let cancelled = false;
		const load = async (): Promise<void> => {
			try {
				const status = await gitStatus(workspace);
				if (!cancelled) setBranch(status);
			} catch {
				if (!cancelled) setBranch(null);
			}
		};
		void load();
		const onChange = (): void => void load();
		window.addEventListener("a-coder:agent-files-changed", onChange);
		return () => {
			cancelled = true;
			window.removeEventListener("a-coder:agent-files-changed", onChange);
		};
	}, [workspace]);

	// Persisted tabs may be stale after a workspace switch or restart: drop
	// tabs outside the (new) workspace and tabs whose file is gone.
	useEffect(() => {
		let cancelled = false;
		void (async () => {
			const { openTabs } = useIdeStore.getState();
			for (const tab of openTabs) {
				if (cancelled) return;
				const inWorkspace = tab.path.startsWith(workspace);
				if (inWorkspace) {
					try {
						await fileInfo(tab.path);
					} catch {
						useIdeStore.getState().closeTab(tab.path);
					}
				} else {
					useIdeStore.getState().closeTab(tab.path);
				}
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [workspace]);

	return (
		<div className="flex min-h-0 min-w-0 flex-1 flex-col">
			<div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
				<IdeRail />

				{/* Sidebar: Explorer or Source control (resizable width) */}
				{sidebarTab && (
					<>
						<aside
							className="flex w-64 shrink-0 flex-col overflow-hidden border-r border-pi-border bg-pi-surface"
							style={{ width: sidebarWidth }}
						>
							{sidebarTab === "explorer" ? (
								<ExplorerTree root={workspace} />
							) : sidebarTab === "git" ? (
								<GitPanel root={workspace} />
							) : (
								<SearchPanel root={workspace} />
							)}
						</aside>
						<ResizeHandle
							orientation="horizontal"
							value={sidebarWidth}
							ariaLabel="Resize sidebar"
							onResize={(next) => setSidebarWidth(clampSize(next, SIDEBAR_MIN, SIDEBAR_MAX))}
							className="w-1 shrink-0 cursor-col-resize bg-transparent transition-colors hover:bg-pi-accent/30"
						/>
					</>
				)}

				{/* Editor + terminal column */}
				<div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-pi-bg">
					<EditorGroup workspaceRoot={workspace} />
					{terminalOpen && (
						<>
							<ResizeHandle
								orientation="vertical"
								value={terminalHeight}
								step={-1}
								ariaLabel="Resize terminal"
								onResize={(next) => setTerminalHeight(clampSize(next, TERMINAL_MIN, TERMINAL_MAX))}
								className="h-1 shrink-0 cursor-row-resize bg-transparent transition-colors hover:bg-pi-accent/30"
							/>
							<div style={{ height: terminalHeight }} className="shrink-0 overflow-hidden">
								<IdeTerminal cwd={workspace} />
							</div>
						</>
					)}
				</div>
			</div>

			{/* Status bar */}
			<div className="flex h-6 shrink-0 items-center gap-3 border-t border-pi-border bg-pi-surface px-3 text-2xs text-pi-text-muted">
				{branch?.branch && (
					<button
						onClick={() => setSidebarTab("git")}
						title={branch.branch.ahead || branch.branch.behind ? `ahead ${branch.branch.ahead} · behind ${branch.branch.behind}` : branch.branch.name}
						className="flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 font-mono transition-smooth hover:bg-pi-surface-raised hover:text-pi-text"
					>
						<GitBranch className="size-3" />
						{branch.branch.name}
						{branch.unstaged.length + branch.staged.length + branch.untracked.length > 0 && (
							<span className="text-pi-warning">
								*
							</span>
						)}
					</button>
				)}
				<span className="truncate font-mono">{workspace}</span>
				<span className="ml-auto text-pi-text-faint">A-Coder IDE</span>
			</div>

			{quickOpenOpen && <QuickOpen root={workspace} onClose={() => setQuickOpenOpen(false)} />}
		</div>
	);
}