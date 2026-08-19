import { FileText, GitBranch } from "lucide-react";
import { useUiStore, type RightSidebarTab } from "../stores/ui-store";
import { triggerHaptic } from "../lib/haptics";
import { ArtifactViewer } from "./panels/ArtifactViewer";
import { FileExplorer } from "./panels/FileExplorer";
import { GitPanel } from "./panels/GitPanel";

interface Props {
	projectPath: string | null;
}

const TABS: {
	id: RightSidebarTab;
	label: string;
	icon: typeof GitBranch;
}[] = [
	{ id: "files", label: "Files", icon: FileText },
	{ id: "git", label: "Git changes", icon: GitBranch },
];

export function RightSidebar({ projectPath }: Props) {
	const { rightSidebarTab, setRightSidebarTab, selectedArtifactPath } = useUiStore();

	return (
		<div className="flex h-full w-full flex-col border-l border-pi-border bg-pi-surface shadow-card transition-smooth">
			{/* Tab strip */}
			<div
				role="tablist"
				aria-label="Right sidebar panels"
				className="flex h-9 shrink-0 items-center gap-0.5 border-b border-pi-border px-1.5"
			>
				{TABS.map(({ id, label, icon: Icon }) => {
					const active = rightSidebarTab === id;
					return (
						<button
							key={id}
							role="tab"
							aria-selected={active}
							onClick={() => {
					triggerHaptic("selection");
					setRightSidebarTab(id);
				}}
							title={label}
							className={`relative flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md px-2 text-2xs font-medium transition-hover active-press focus-visible:shadow-focus focus-visible:outline-none ${
								active
									? "bg-pi-surface-raised text-pi-text shadow-ring hover:shadow-card-hover"
									: "text-pi-text-muted hover:bg-pi-surface-raised hover:text-pi-text hover:shadow-card-hover"
							}`}
						>
							<Icon className="h-3.5 w-3.5 transition-smooth" />
							<span className="truncate">{id === "files" ? "Files" : "Git"}</span>
							{active && (
								<span className="absolute inset-x-2 -bottom-px h-px bg-pi-accent shadow-focus-inner" />
							)}
						</button>
					);
				})}
			</div>

			{/* Active panel */}
			<div className="flex-1 min-h-0 w-full min-w-0">
				{rightSidebarTab === "files" && (
					selectedArtifactPath ? (
						<ArtifactViewer projectPath={projectPath} path={selectedArtifactPath} />
					) : (
						<FileExplorer projectPath={projectPath} />
					)
				)}
				{rightSidebarTab === "git" && <GitPanel projectPath={projectPath} />}
			</div>
		</div>
	);
}
