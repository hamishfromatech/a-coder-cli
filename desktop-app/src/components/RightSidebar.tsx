import { AlarmClock, CalendarClock, FileText, GitBranch, Inbox } from "lucide-react";
import { useUiStore, type RightSidebarTab } from "../stores/ui-store";
import { useActivityAttentionCount } from "../stores/activity-store";
import { triggerHaptic } from "../lib/haptics";
import { ArtifactViewer } from "./panels/ArtifactViewer";
import { FileExplorer } from "./panels/FileExplorer";
import { GitPanel } from "./panels/GitPanel";
import { OfficePanel } from "./office/OfficePanel";
import { CronPanel } from "./cron/CronPanel";
import { ActivityPanel } from "./activity/ActivityPanel";

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
	{ id: "office", label: "Office", icon: CalendarClock },
	{ id: "cron", label: "Scheduled", icon: AlarmClock },
	{ id: "activity", label: "Activity", icon: Inbox },
];

export function RightSidebar({ projectPath }: Props) {
	const { rightSidebarTab, setRightSidebarTab, selectedArtifactPath } = useUiStore();
	const attention = useActivityAttentionCount();
	const activeLabel = TABS.find(({ id }) => id === rightSidebarTab)?.label ?? "";

	return (
		<div className="flex h-full w-full flex-row bg-pi-surface shadow-card">
			{/* Vertical icon rail: the sidebar's inner edge. Tooltips carry the
			    names; the active panel repeats its name in a slim header. */}
			<div
				role="tablist"
				aria-label="Right sidebar panels"
				aria-orientation="vertical"
				className="flex w-11 shrink-0 flex-col gap-1 border-r border-pi-border px-1 py-2"
			>
				{TABS.map(({ id, label, icon: Icon }) => {
					const active = rightSidebarTab === id;
					return (
						<button
							key={id}
							role="tab"
							aria-selected={active}
							title={label}
							onClick={() => {
								triggerHaptic("selection");
								setRightSidebarTab(id);
							}}
							className={`relative flex h-9 w-full cursor-pointer items-center justify-center rounded-md transition-hover active-press focus-visible:shadow-focus focus-visible:outline-none ${
								active
									? "bg-pi-surface-raised text-pi-text shadow-ring hover:shadow-card-hover"
									: "text-pi-text-muted hover:bg-pi-surface-raised hover:text-pi-text hover:shadow-card-hover"
							}`}
						>
							<Icon className="h-4 w-4 transition-smooth" />
							{id === "activity" && attention > 0 && (
								<span
									className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-pi-accent px-1 text-[9px] font-semibold leading-none text-white"
									aria-label={`${attention} items need attention`}
								>
									{attention > 9 ? "9+" : attention}
								</span>
							)}
							{active && (
								<span className="absolute inset-y-1 left-0 w-0.5 rounded-full bg-pi-accent" />
							)}
						</button>
					);
				})}
			</div>

			{/* Content: a slim active-panel header, then the panel itself. */}
			<div className="flex min-w-0 flex-1 flex-col">
				<div className="flex h-8 shrink-0 items-center border-b border-pi-border px-3">
					<span className="text-3xs font-medium uppercase tracking-wide text-pi-text-muted">
						{activeLabel}
					</span>
				</div>
				<div className="min-h-0 w-full min-w-0 flex-1">
					{rightSidebarTab === "files" &&
						(selectedArtifactPath ? (
							<ArtifactViewer projectPath={projectPath} path={selectedArtifactPath} />
						) : (
							<FileExplorer projectPath={projectPath} />
						))}
					{rightSidebarTab === "git" && <GitPanel projectPath={projectPath} />}
					{rightSidebarTab === "office" && <OfficePanel />}
					{rightSidebarTab === "cron" && <CronPanel />}
					{rightSidebarTab === "activity" && <ActivityPanel />}
				</div>
			</div>
		</div>
	);
}