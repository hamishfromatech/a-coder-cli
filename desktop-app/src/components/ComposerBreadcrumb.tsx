import { useEffect, useRef, useState } from "react";
import { ChevronDown, FolderGit2, GitBranch, Plus } from "lucide-react";
import { useWorkspaceStore } from "../stores/workspace-store";
import { useSessionStore } from "../stores/session-store";
import * as rpc from "../lib/rpc";
import { triggerHaptic } from "../lib/haptics";

/** Composer header breadcrumb: project selector + git branch chip.
 *  OpenCode-style "where does this session run" control. Switching project is
 *  delegated to App via the `a-coder:switch-project` event; "Add folder…"
 *  reuses the project picker via `a-coder:open-session-picker`. */
export function ComposerBreadcrumb() {
	const current = useWorkspaceStore((s) => s.current);
	const recentProjects = useWorkspaceStore((s) => s.recentProjects);
	const cwd = useSessionStore((s) => s.cwd);
	const [open, setOpen] = useState(false);
	const [branch, setBranch] = useState<string | null>(null);
	const menuRef = useRef<HTMLDivElement>(null);

	const projectName = current
		? current.split(/[/\\]/).filter(Boolean).at(-1) ?? current
		: "No project";

	// Resolve the git branch for the current project (non-git → null).
	useEffect(() => {
		let cancelled = false;
		const dir = current || cwd || "";
		if (!dir) {
			setBranch(null);
			return;
		}
		rpc
			.gitStatus(dir)
			.then((s) => {
				if (!cancelled) setBranch(s.branch?.name ?? null);
			})
			.catch(() => {
				if (!cancelled) setBranch(null);
			});
		return () => {
			cancelled = true;
		};
	}, [current, cwd]);

	// Close the dropdown on outside click.
	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
				setOpen(false);
			}
		};
		document.addEventListener("mousedown", onDown);
		return () => document.removeEventListener("mousedown", onDown);
	}, [open]);

	const switchTo = (path: string) => {
		triggerHaptic("selection");
		setOpen(false);
		window.dispatchEvent(
			new CustomEvent("a-coder:switch-project", { detail: { path } }),
		);
	};

	const addFolder = () => {
		setOpen(false);
		window.dispatchEvent(new CustomEvent("a-coder:open-session-picker"));
	};

	return (
		<div className="flex items-center gap-1.5 px-2 pb-1.5 text-2xs text-pi-text-muted">
			<div className="relative" ref={menuRef}>
				<button
					type="button"
					onClick={() => {
						triggerHaptic("selection");
						setOpen((v) => !v);
					}}
					className="flex h-6 max-w-44 items-center gap-1.5 rounded-md px-1.5 text-pi-text-secondary transition-hover hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
					title={current || "No project"}
				>
					<FolderGit2 className="h-3.5 w-3.5 shrink-0 text-pi-text-faint" />
					<span className="truncate font-medium">{projectName}</span>
					<ChevronDown className="h-3 w-3 shrink-0 text-pi-text-faint" />
				</button>
				{open && (
					<div className="absolute left-0 top-full z-30 mt-1 w-60 overflow-hidden rounded-lg border border-pi-border bg-pi-surface shadow-card">
						<div className="max-h-72 overflow-auto py-1">
							{recentProjects.length === 0 ? (
								<div className="px-2.5 py-2 text-2xs text-pi-text-faint">
									No recent projects.
								</div>
							) : (
								recentProjects.slice(0, 8).map((path) => {
									const active = path === current;
									const name = path.split(/[/\\]/).filter(Boolean).at(-1) ?? path;
									return (
										<button
											key={path}
											type="button"
											onClick={() => switchTo(path)}
											title={path}
											className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-hover ${
												active
													? "bg-pi-accent-soft text-pi-accent"
													: "text-pi-text-secondary hover:bg-pi-surface-raised hover:text-pi-text"
											}`}
										>
											<FolderGit2
												className={`h-3.5 w-3.5 shrink-0 ${
													active ? "text-pi-accent" : "text-pi-text-muted"
												}`}
											/>
											<span className="min-w-0 flex-1 truncate">{name}</span>
											{active && (
												<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-pi-accent" />
											)}
										</button>
									);
								})
							)}
						</div>
						<div className="border-t border-pi-border p-1">
							<button
								type="button"
								onClick={addFolder}
								className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-pi-text-secondary transition-hover hover:bg-pi-surface-raised hover:text-pi-text"
							>
								<Plus className="h-3.5 w-3.5 shrink-0 text-pi-text-muted" />
								Add folder…
							</button>
						</div>
					</div>
				)}
			</div>

			{branch && (
				<>
					<span className="select-none opacity-40">/</span>
					<div
						className="flex h-6 max-w-48 items-center gap-1.5 px-1.5 text-pi-text-muted"
						title={`Git branch: ${branch}`}
					>
						<GitBranch className="h-3 w-3 shrink-0 text-pi-text-faint" />
						<span className="truncate">{branch}</span>
					</div>
				</>
			)}
		</div>
	);
}