import { open } from "@tauri-apps/plugin-dialog";
import { Clock, Folder, FolderOpen, Trash2, X } from "lucide-react";
import { useRef } from "react";
import { useModalA11y } from "../hooks/useModalA11y";
import { useWorkspaceStore } from "../stores/workspace-store";
import { triggerHaptic } from "../lib/haptics";

export interface ProjectPickerProps {
	onClose: () => void;
	onSelect: (path: string) => void;
}

export function ProjectPicker({ onClose, onSelect }: ProjectPickerProps) {
	const modalRef = useRef<HTMLDivElement>(null);
	useModalA11y(modalRef, true, onClose);
	const { current, recentProjects, clearRecent, removeRecent } = useWorkspaceStore();

	const handlePickFolder = async () => {
		triggerHaptic("crisp");
		try {
			const path = await open({ directory: true });
			if (typeof path === "string") {
				onSelect(path);
			}
		} catch (e) {
			console.error("Failed to pick folder", e);
		}
	};

	const displayName = (path: string) => {
		if (!path) return "No project selected";
		const parts = path.split(/[/\\]/).filter(Boolean);
		return parts.at(-1) ?? path;
	};

	return (
		<div
			ref={modalRef}
			role="dialog"
			aria-modal="true"
			aria-label="Switch project"
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
			onClick={onClose}
		>
			<div
				className="flex w-full max-w-md flex-col overflow-hidden rounded-xl bg-pi-surface-overlay shadow-overlay"
				onClick={(e) => e.stopPropagation()}
			>
				{/* Header */}
				<div className="flex items-center justify-between border-b border-pi-border px-4 py-3">
					<div>
						<h2 className="text-[13px] font-semibold tracking-tight">
							Switch project
						</h2>
						<p className="mt-0.5 text-2xs text-pi-text-muted">
							Pick a folder to load into A-Coder.
						</p>
					</div>
					<button
						onClick={onClose}
						className="rounded p-1 text-pi-text-muted transition-hover active-press hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
						title="Close"
						aria-label="Close"
					>
						<X className="h-3.5 w-3.5" />
					</button>
				</div>

				{/* Current project */}
				<div className="border-b border-pi-border p-3">
					<div className="mb-1 text-3xs font-semibold uppercase tracking-wider text-pi-text-faint">
						Current
					</div>
					<div className="flex items-center gap-2.5 rounded-md bg-pi-surface-raised p-2.5">
						<div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-pi-accent-soft text-pi-accent">
							<Folder className="h-3.5 w-3.5" />
						</div>
						<div className="min-w-0 flex-1">
							<div className="truncate text-xs font-medium text-pi-text">
								{displayName(current)}
							</div>
							{current && (
								<div
									className="truncate font-mono text-3xs text-pi-text-muted"
									title={current}
								>
									{current}
								</div>
							)}
						</div>
					</div>
				</div>

				{/* Pick folder button */}
				<div className="border-b border-pi-border p-3">
					<button
						onClick={() => void handlePickFolder()}
						className="flex w-full items-center justify-center gap-2 rounded-md bg-pi-accent px-3 py-2 text-xs font-medium text-white shadow-ring-accent transition-hover active-press hover:bg-pi-accent-hover"
					>
						<FolderOpen className="h-3.5 w-3.5" />
						Choose folder…
					</button>
				</div>

				{/* Recent projects */}
				<div className="flex-1 overflow-hidden p-3">
					<div className="mb-2 flex items-center justify-between">
						<span className="flex items-center gap-1.5 text-3xs font-semibold uppercase tracking-wider text-pi-text-faint">
							<Clock className="h-3 w-3" />
							Recent
						</span>
						{recentProjects.length > 0 && (
							<button
								onClick={clearRecent}
								className="text-3xs text-pi-text-muted transition-hover active-press hover:text-pi-error"
							>
								Clear all
							</button>
						)}
					</div>

					<div className="max-h-48 space-y-0.5 overflow-auto">
						{recentProjects.length === 0 ? (
							<p className="px-2 py-3 text-center text-2xs text-pi-text-faint">
								No recent projects yet.
							</p>
						) : (
							recentProjects.map((path) => {
								const isActive = path === current;
								return (
									<div
										key={path}
										className={`group flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition-hover active-press focus-visible:shadow-focus focus-visible:outline-none ${
											isActive
												? "bg-pi-accent-soft"
												: "hover:bg-pi-surface-raised"
										}`}
									>
										<button
											onClick={() => {
											triggerHaptic("selection");
											onSelect(path);
										}}
											className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left transition-hover focus-visible:shadow-focus focus-visible:outline-none"
										>
											<Folder
												className={`h-3.5 w-3.5 shrink-0 ${
													isActive
														? "text-pi-accent"
														: "text-pi-text-muted"
												}`}
											/>
											<div className="min-w-0">
												<div
													className={`truncate text-xs font-medium ${
														isActive
															? "text-pi-accent"
															: "text-pi-text"
													}`}
												>
													{displayName(path)}
												</div>
												<div
													className="truncate font-mono text-3xs text-pi-text-faint"
													title={path}
												>
													{path}
												</div>
										</div>
										</button>
										<button
											onClick={(e) => {
												e.stopPropagation();
												removeRecent(path);
											}}
											className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-pi-text-faint opacity-0 transition-all hover:bg-pi-surface-overlay hover:text-pi-error group-hover:opacity-100 focus-visible:opacity-100"
											title="Remove from recent"
											aria-label="Remove from recent"
										>
											<Trash2 className="h-3 w-3" />
										</button>
									</div>
								);
							})
						)}
					</div>
				</div>
			</div>
		</div>
	);
}
