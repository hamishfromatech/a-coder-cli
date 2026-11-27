import { useCallback } from "react";
import { ExplorerTree } from "../ide/ExplorerTree";
import { getDefaultViewMode } from "../../lib/files";
import { relativeToRoot } from "../../lib/explorer";
import { triggerHaptic } from "../../lib/haptics";
import { useUiStore } from "../../stores/ui-store";

interface Props {
	projectPath: string | null;
}

/**
 * Files panel in the right sidebar.
 *
 * The lazy IDE explorer already provides per-folder loading, search, keyboard
 * navigation, git decorations, create/rename/delete and reveal. The sidebar
 * uses the same tree with two differences: opening a file previews it in the
 * artifact viewer instead of creating an editor tab, and files can be dragged
 * or attached straight into the composer.
 */
export function FileExplorer({ projectPath }: Props) {
	const setSelectedArtifactPath = useUiStore((s) => s.setSelectedArtifactPath);
	const setSelectedArtifactViewMode = useUiStore((s) => s.setSelectedArtifactViewMode);
	const setRightSidebarOpen = useUiStore((s) => s.setRightSidebarOpen);

	const openFile = useCallback(
		(absolutePath: string) => {
			if (!projectPath) return;
			const relative = relativeToRoot(absolutePath, projectPath);
			triggerHaptic("selection");
			setSelectedArtifactViewMode(getDefaultViewMode(relative));
			setSelectedArtifactPath(relative);
			setRightSidebarOpen(true);
		},
		[projectPath, setSelectedArtifactPath, setSelectedArtifactViewMode, setRightSidebarOpen],
	);

	const attachFile = useCallback((absolutePath: string) => {
		triggerHaptic("selection");
		window.dispatchEvent(
			new CustomEvent("a-coder:attach-files", { detail: { paths: [absolutePath] } }),
		);
	}, []);

	if (!projectPath) {
		return (
			<div className="flex h-full flex-1 items-center justify-center p-6 text-center text-2xs text-pi-text-faint">
				No project open.
			</div>
		);
	}

	return (
		<ExplorerTree
			root={projectPath}
			title="Files"
			onOpenFile={openFile}
			onAttachFile={attachFile}
			revealActivePath={false}
			hideNoise
		/>
	);
}
