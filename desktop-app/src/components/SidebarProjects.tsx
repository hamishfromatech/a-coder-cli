import { Folder, FolderPlus } from "lucide-react";
import { useWorkspaceStore } from "../stores/workspace-store";
import { triggerHaptic } from "../lib/haptics";

/** Inline recent-projects list for the left sidebar — the OpenCode-style
 *  "switch workspace without a modal" surface. Mirrors ProjectPicker's recent
 *  list but rendered as a compact sidebar section. */
export function SidebarProjects({
	onSelect,
	onAdd,
}: {
	onSelect: (path: string) => void;
	onAdd: () => void;
}) {
	const current = useWorkspaceStore((s) => s.current);
	const recentProjects = useWorkspaceStore((s) => s.recentProjects);
	const removeRecent = useWorkspaceStore((s) => s.removeRecent);

	const displayName = (path: string) => {
		const parts = path.split(/[/\\]/).filter(Boolean);
		return parts.at(-1) ?? path;
	};

	return (
		<div className="space-y-0.5">
			{recentProjects.length === 0 ? (
				<button
					onClick={() => {
						triggerHaptic("selection");
						onAdd();
					}}
					className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-pi-text-muted transition-hover active-press hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
				>
					<FolderPlus className="h-3.5 w-3.5 shrink-0" />
					Add folder…
				</button>
			) : (
				<>
					{recentProjects.slice(0, 6).map((path) => {
						const isActive = path === current;
						return (
							<div
								key={path}
								className={`group/proj flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-1.5 transition-hover active-press focus-visible:shadow-focus focus-visible:outline-none ${
									isActive ? "bg-pi-accent-soft" : "hover:bg-pi-surface-raised"
								}`}
							>
								<button
									type="button"
									onClick={() => {
										triggerHaptic("selection");
										onSelect(path);
									}}
									className="flex min-w-0 flex-1 items-center gap-2 text-left"
									title={path}
								>
									<Folder
										className={`h-3.5 w-3.5 shrink-0 ${
											isActive ? "text-pi-accent" : "text-pi-text-muted"
										}`}
									/>
									<span
										className={`truncate text-[12px] font-medium ${
											isActive ? "text-pi-accent" : "text-pi-text"
										}`}
									>
										{displayName(path)}
									</span>
								</button>
								<button
									type="button"
									onClick={(e) => {
										e.stopPropagation();
										removeRecent(path);
									}}
									className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-pi-text-faint opacity-0 transition-all hover:bg-pi-surface-overlay hover:text-pi-error group-hover/proj:opacity-100 focus-visible:opacity-100"
									title="Remove from recent"
									aria-label="Remove from recent"
								>
									<span className="text-[14px] leading-none">×</span>
								</button>
							</div>
						);
					})}
					<button
						type="button"
						onClick={() => {
							triggerHaptic("selection");
							onAdd();
						}}
						className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-pi-text-muted transition-hover active-press hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
					>
						<FolderPlus className="h-3.5 w-3.5 shrink-0" />
						Add folder…
					</button>
				</>
			)}
		</div>
	);
}