import {
	ChevronDown,
	ChevronRight,
	FileAudio,
	FileText,
	FileVideo,
	Folder,
	FolderOpen,
	Image as ImageIcon,
	Loader2,
	RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { listDirectory, type DirEntry } from "../../lib/rpc";
import { getDefaultViewMode, getFileKind } from "../../lib/files";
import { useUiStore } from "../../stores/ui-store";
import { triggerHaptic } from "../../lib/haptics";

function fileIcon(path: string) {
	const kind = getFileKind(path);
	switch (kind) {
		case "image":
			return ImageIcon;
		case "audio":
			return FileAudio;
		case "video":
			return FileVideo;
		default:
			return FileText;
	}
}

interface Props {
	projectPath: string | null;
}

export function FileExplorer({ projectPath }: Props) {
	const [entries, setEntries] = useState<DirEntry[]>([]);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const { setSelectedArtifactPath, setSelectedArtifactViewMode, setRightSidebarOpen } =
		useUiStore();

	const load = useCallback(async () => {
		if (!projectPath) {
			setEntries([]);
			setError(null);
			return;
		}
		setLoading(true);
		setError(null);
		try {
			const tree = await listDirectory(projectPath);
			setEntries(tree);
			// Expand the top-level folders by default.
			setExpanded((prev) => {
				const next = new Set(prev);
				for (const entry of tree) {
					if (entry.is_dir) next.add(entry.path);
				}
				return next;
			});
		} catch (e) {
			setEntries([]);
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setLoading(false);
		}
	}, [projectPath]);

	useEffect(() => {
		void load();
	}, [load]);

	const toggle = (path: string) => {
		triggerHaptic("selection");
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	};

	const handleFileClick = (path: string) => {
		triggerHaptic("selection");
		setSelectedArtifactViewMode(getDefaultViewMode(path));
		setSelectedArtifactPath(path);
		// Ensure the sidebar stays open while viewing a file.
		setRightSidebarOpen(true);
	};

	if (!projectPath) {
		return (
			<div className="flex flex-1 items-center justify-center p-6 text-center text-2xs text-pi-text-faint">
				No project open.
			</div>
		);
	}

	return (
		<div className="flex h-full w-full min-w-0 flex-col">
			{/* Header */}
			<div className="flex items-center justify-between border-b border-pi-border px-3 py-2">
				<span className="text-2xs font-semibold tracking-tight">Files</span>
				<button
					onClick={() => {
					triggerHaptic("crisp");
					void load();
				}}
					className="rounded p-1 text-pi-text-muted transition-hover active-press hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
aria-label="Refresh"
					disabled={loading}
				>
					{loading ? (
						<Loader2 className="h-3 w-3 animate-spin" />
					) : (
						<RefreshCw className="h-3 w-3" />
					)}
				</button>
			</div>

			{/* Body */}
			<div className="flex-1 min-h-0 overflow-auto p-2">
				{error && (
					<div className="mb-2 rounded-md bg-pi-error-soft px-3 py-2 text-2xs text-pi-error">
						{error}
					</div>
				)}

				{loading && entries.length === 0 && (
					<div className="flex items-center justify-center gap-2 p-6 text-2xs text-pi-text-muted">
						<Loader2 className="h-3 w-3 animate-spin" /> Loading files…
					</div>
				)}

				{!loading && entries.length === 0 && !error && (
					<div className="flex items-center justify-center p-6 text-center text-2xs text-pi-text-faint">
						No files found.
					</div>
				)}

				<div className="flex flex-col">
					{entries.map((entry) => (
						<TreeItem
							key={entry.path}
							entry={entry}
							depth={0}
							expanded={expanded}
							toggle={toggle}
							onFileClick={handleFileClick}
						/>
					))}
				</div>
			</div>
		</div>
	);
}

interface TreeItemProps {
	entry: DirEntry;
	depth: number;
	expanded: Set<string>;
	toggle: (path: string) => void;
	onFileClick: (path: string) => void;
}

function TreeItem({ entry, depth, expanded, toggle, onFileClick }: TreeItemProps) {
	const isExpanded = expanded.has(entry.path);
	const paddingLeft = depth * 12 + 4;

	if (entry.is_dir) {
		return (
			<div className="select-none">
				<button
					onClick={() => toggle(entry.path)}
					className="group flex h-7 w-full items-center gap-1 rounded-md px-1.5 text-left text-xs text-pi-text-secondary transition-hover active-press hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
					style={{ paddingLeft }}
				>
					{isExpanded ? (
						<ChevronDown className="h-3.5 w-3.5 shrink-0 text-pi-text-muted" />
					) : (
						<ChevronRight className="h-3.5 w-3.5 shrink-0 text-pi-text-muted" />
					)}
					{isExpanded ? (
						<FolderOpen className="h-3.5 w-3.5 shrink-0 text-pi-accent" />
					) : (
						<Folder className="h-3.5 w-3.5 shrink-0 text-pi-text-muted" />
					)}
					<span className="truncate" title={entry.name}>
						{entry.name}
					</span>
				</button>

				{isExpanded && entry.children.length > 0 && (
					<div>
						{entry.children.map((child) => (
							<TreeItem
								key={child.path}
								entry={child}
								depth={depth + 1}
								expanded={expanded}
								toggle={toggle}
								onFileClick={onFileClick}
							/>
						))}
					</div>
				)}
			</div>
		);
	}

	const Icon = fileIcon(entry.path);
	return (
		<button
			onClick={() => onFileClick(entry.path)}
			className="group flex h-7 w-full items-center gap-1.5 rounded-md px-1.5 text-left text-xs text-pi-text-secondary transition-hover active-press hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
			style={{ paddingLeft }}

		>
			<span className="w-3.5 shrink-0" />
			<Icon className="h-3.5 w-3.5 shrink-0 text-pi-text-muted" />
			<span className="truncate">{entry.name}</span>
		</button>
	);
}
