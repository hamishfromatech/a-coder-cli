import { create } from "zustand";
import { persist } from "zustand/middleware";

export type RightSidebarTab = "files" | "git";
export type ArtifactViewMode = "raw" | "preview";

export interface UiState {
	leftSidebarOpen: boolean;
	rightSidebarOpen: boolean;
	rightSidebarWidth: number;
	rightSidebarTab: RightSidebarTab;

	selectedGitFile: string | null;
	selectedGitStaged: boolean;

	selectedArtifactPath: string | null;
	selectedArtifactViewMode: ArtifactViewMode;

	setLeftSidebarOpen: (open: boolean) => void;
	setRightSidebarOpen: (open: boolean) => void;
	setRightSidebarWidth: (width: number) => void;
	setRightSidebarTab: (tab: RightSidebarTab) => void;
	setSelectedGitFile: (path: string | null, staged?: boolean) => void;
	setSelectedArtifactPath: (path: string | null) => void;
	setSelectedArtifactViewMode: (mode: ArtifactViewMode) => void;
	toggleLeftSidebar: () => void;
	toggleRightSidebar: () => void;
}

export const useUiStore = create<UiState>()(
	persist(
		(set, get) => ({
			leftSidebarOpen: true,
			rightSidebarOpen: false,
			rightSidebarWidth: 320,
			rightSidebarTab: "files",

			selectedGitFile: null,
			selectedGitStaged: false,
			selectedArtifactPath: null,
			selectedArtifactViewMode: "preview",

			setLeftSidebarOpen: (open) => set({ leftSidebarOpen: open }),
			setRightSidebarOpen: (open) => set({ rightSidebarOpen: open }),
			setRightSidebarWidth: (width) => set({ rightSidebarWidth: width }),
			setRightSidebarTab: (tab) => set({ rightSidebarTab: tab, rightSidebarOpen: true }),
			setSelectedGitFile: (path, staged) =>
				set({ selectedGitFile: path, selectedGitStaged: staged ?? false }),
			setSelectedArtifactPath: (path) => set({ selectedArtifactPath: path }),
			setSelectedArtifactViewMode: (mode) => set({ selectedArtifactViewMode: mode }),
			toggleLeftSidebar: () => set({ leftSidebarOpen: !get().leftSidebarOpen }),
			toggleRightSidebar: () => set({ rightSidebarOpen: !get().rightSidebarOpen }),
		}),
		{
			name: "a-coder-desktop-ui",
			version: 1,
			migrate: (persisted) => {
				const state = (persisted ?? {}) as Partial<UiState>;
				// Older persisted states used tabs like "html" / "markdown" that no longer exist.
				if (
					state.rightSidebarTab !== "files" &&
					state.rightSidebarTab !== "git"
				) {
					state.rightSidebarTab = "files";
				}
				return state as UiState;
			},
			partialize: (state) => ({
				leftSidebarOpen: state.leftSidebarOpen,
				rightSidebarOpen: state.rightSidebarOpen,
				rightSidebarWidth: state.rightSidebarWidth,
				rightSidebarTab: state.rightSidebarTab,
			}),
		},
	),
);
