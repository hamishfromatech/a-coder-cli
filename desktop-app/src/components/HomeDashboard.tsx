/**
 * Home Dashboard — unified view with projects sidebar and sessions grouped by time.
 * Mirrors OpenCode's NewHome + HomeProjects + HomeSessions pattern.
 */

import { useCallback, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "./ui/Button";
import { groupSessionsByTime, formatRelativeTime, type GroupableSession, type SessionGroup } from "../lib/session-grouping";
import { useClosedTabsStore } from "../stores/closed-tabs-store";
import {
	ChevronDown,
	ChevronRight,
	Clock,
	FolderGit2,
	Plus,
	Search,
	X,
	History,
} from "lucide-react";

interface HomeDashboardProps {
	open: boolean;
	onClose: () => void;
	sessions: GroupableSession[];
	projects: Array<{ path: string; name: string }>;
	onOpenSession: (sessionId: string) => void;
	onOpenProject: (path: string) => void;
	onNewSession: (projectPath?: string) => void;
}

export function HomeDashboard({
	open,
	onClose,
	sessions,
	projects,
	onOpenSession,
	onOpenProject,
	onNewSession,
}: HomeDashboardProps) {
	const [searchQuery, setSearchQuery] = useState("");
	const [selectedProject, setSelectedProject] = useState<string | null>(null);
	const closedTabs = useClosedTabsStore((s) => s.stack);
	const takeClosedTab = useClosedTabsStore((s) => s.take);

	// Filter sessions by search and project
	const filteredSessions = useMemo(() => {
		let result = sessions;
		if (searchQuery.trim()) {
			const needle = searchQuery.trim().toLowerCase();
			result = result.filter(
				(s) =>
					s.name.toLowerCase().includes(needle) ||
					s.projectName?.toLowerCase().includes(needle),
			);
		}
		if (selectedProject) {
			result = result.filter((s) => s.projectPath === selectedProject);
		}
		return result;
	}, [sessions, searchQuery, selectedProject]);

	// Group sessions by time
	const groups = useMemo(() => groupSessionsByTime(filteredSessions), [filteredSessions]);

	// Handle re-open closed tab
	const handleReopenClosedTab = useCallback(() => {
		const tab = takeClosedTab();
		if (tab) {
			onOpenSession(tab.sessionId);
		}
	}, [takeClosedTab, onOpenSession]);

	if (!open) return null;

	return createPortal(
		<div className="fixed inset-0 z-[var(--z-modal)] flex flex-col bg-[var(--pi-bg)]">
			{/* Header */}
			<header className="flex shrink-0 items-center justify-between border-b border-[var(--pi-border)] bg-[var(--pi-surface)] px-4 py-3">
				<h1 className="text-sm font-semibold text-[var(--pi-text)]">Home</h1>
				<div className="flex items-center gap-2">
					{closedTabs.length > 0 && (
						<Button size="sm" variant="secondary" onClick={handleReopenClosedTab}>
							<History className="size-3" />
							Reopen closed
						</Button>
					)}
					<Button size="sm" onClick={() => onNewSession(selectedProject ?? undefined)}>
						<Plus className="size-3" />
						New session
					</Button>
					<button
						onClick={onClose}
						className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--pi-text-muted)] transition-colors hover:bg-[var(--pi-surface-raised)] hover:text-[var(--pi-text)]"
					>
						<X className="size-4" />
					</button>
				</div>
			</header>

			{/* Main content */}
			<div className="flex min-h-0 flex-1 overflow-hidden">
				{/* Projects sidebar */}
				<aside className="w-56 shrink-0 border-r border-[var(--pi-border)] bg-[var(--pi-surface)] overflow-auto">
					<div className="p-2">
						<div className="mb-2 text-[10px] font-medium uppercase tracking-[0.08em] text-[var(--pi-text-faint)]">
							Projects
						</div>
						{projects.map((project) => (
							<button
								key={project.path}
								className={`
									w-full text-left rounded-md px-2 py-1.5 text-xs transition-colors
									${selectedProject === project.path
										? "bg-[var(--pi-accent-soft)] text-[var(--pi-accent)]"
										: "text-[var(--pi-text-secondary)] hover:bg-[var(--pi-surface-raised)] hover:text-[var(--pi-text)]"
									}
								`}
								onClick={() => setSelectedProject(selectedProject === project.path ? null : project.path)}
								onDoubleClick={() => onOpenProject(project.path)}
							>
								<div className="flex items-center gap-1.5">
									<FolderGit2 className="size-3.5 shrink-0" />
									<span className="truncate">{project.name}</span>
								</div>
							</button>
						))}
						{projects.length === 0 && (
							<div className="px-2 py-1.5 text-xs text-[var(--pi-text-muted)]">
								No projects yet
							</div>
						)}
					</div>
				</aside>

				{/* Sessions list */}
				<main className="min-w-0 flex-1 overflow-auto p-4">
					{/* Search */}
					<div className="mb-4 flex items-center gap-2">
						<Search className="size-4 text-[var(--pi-text-muted)]" />
						<input
							className="h-8 flex-1 rounded-md border border-[var(--pi-border)] bg-transparent px-3 text-sm text-[var(--pi-text)] outline-none focus:border-[var(--pi-accent)]"
							onChange={(e) => setSearchQuery(e.target.value)}
							placeholder="Search sessions..."
							value={searchQuery}
						/>
					</div>

					{/* Session groups */}
					{groups.length === 0 ? (
						<div className="flex h-32 items-center justify-center text-xs text-[var(--pi-text-muted)]">
							{searchQuery ? "No sessions found" : "No sessions yet"}
						</div>
					) : (
						<div className="space-y-4">
							{groups.map((group) => (
								<SessionGroupCard
									key={group.id}
									group={group}
									onOpenSession={onOpenSession}
								/>
							))}
						</div>
					)}
				</main>
			</div>

			{/* Footer */}
			<footer className="flex shrink-0 items-center justify-between border-t border-[var(--pi-border)] bg-[var(--pi-surface)] px-4 py-2 text-[10px] text-[var(--pi-text-faint)]">
				<span>{sessions.length} sessions · {projects.length} projects</span>
				<span>Esc to close</span>
			</footer>
		</div>,
		document.body,
	);
}

interface SessionGroupCardProps {
	group: SessionGroup;
	onOpenSession: (sessionId: string) => void;
}

function SessionGroupCard({ group, onOpenSession }: SessionGroupCardProps) {
	const [expanded, setExpanded] = useState(true);

	return (
		<section>
			<button
				className="flex w-full items-center gap-1 text-left text-xs font-medium text-[var(--pi-text)]"
				onClick={() => setExpanded(!expanded)}
			>
				{expanded ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
				{group.label}
				<span className="text-[var(--pi-text-muted)]">({group.sessions.length})</span>
			</button>

			{expanded && (
				<ul className="mt-1.5 space-y-0.5 pl-4">
					{group.sessions.map((session) => (
						<li key={session.id}>
							<button
								className="group flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-[var(--pi-surface-raised)]"
								onClick={() => onOpenSession(session.id)}
							>
								<div className="min-w-0 flex-1">
									<div className="truncate text-[var(--pi-text)]">{session.name || "Untitled"}</div>
									{session.projectName && (
										<div className="truncate text-[10px] text-[var(--pi-text-muted)]">
											{session.projectName}
										</div>
									)}
								</div>
								<div className="flex shrink-0 items-center gap-1.5 text-[10px] text-[var(--pi-text-muted)]">
									<Clock className="size-3" />
									{formatRelativeTime(session.lastActive)}
								</div>
							</button>
						</li>
					))}
				</ul>
			)}
		</section>
	);
}