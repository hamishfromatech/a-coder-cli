import { create } from "zustand";
import { persist } from "zustand/middleware";

export type RightSidebarTab = "files" | "git" | "office" | "cron" | "activity" | "browser" | "voice";
export type ArtifactViewMode = "raw" | "preview";
export type InterfaceMode = "simple" | "advanced" | "ide";

/** The left sidebar's active section; the rail switches it. */
export type LeftSidebarSection = "sessions" | "projects";

export interface UiState {
	leftSidebarOpen: boolean;
	leftSidebarSection: LeftSidebarSection;
	leftSidebarWidth: number;
	rightSidebarOpen: boolean;
	rightSidebarWidth: number;
	rightSidebarTab: RightSidebarTab;
	interfaceMode: InterfaceMode;

	selectedGitFile: string | null;
	selectedGitStaged: boolean;

	selectedArtifactPath: string | null;
	selectedArtifactViewMode: ArtifactViewMode;

	setLeftSidebarOpen: (open: boolean) => void;
	setLeftSidebarSection: (section: LeftSidebarSection) => void;
	setLeftSidebarWidth: (width: number) => void;
	setRightSidebarOpen: (open: boolean) => void;
	setRightSidebarWidth: (width: number) => void;
	setRightSidebarTab: (tab: RightSidebarTab) => void;
	setInterfaceMode: (mode: InterfaceMode) => void;
	setSelectedGitFile: (path: string | null, staged?: boolean) => void;
	setSelectedArtifactPath: (path: string | null) => void;
	setSelectedArtifactViewMode: (mode: ArtifactViewMode) => void;
	toggleLeftSidebar: () => void;
	toggleRightSidebar: () => void;
	toggleInterfaceMode: () => void;
}

export const useUiStore = create<UiState>()(
	persist(
		(set, get) => ({
			leftSidebarOpen: true,
			leftSidebarSection: "sessions" as LeftSidebarSection,
			leftSidebarWidth: 272,
			rightSidebarOpen: false,
			rightSidebarWidth: 320,
			rightSidebarTab: "files",
			interfaceMode: "advanced",

			selectedGitFile: null,
			selectedGitStaged: false,
			selectedArtifactPath: null,
			selectedArtifactViewMode: "preview",

			setLeftSidebarOpen: (open) => set({ leftSidebarOpen: open }),
			setLeftSidebarSection: (leftSidebarSection) => set({ leftSidebarSection, leftSidebarOpen: true }),
			setLeftSidebarWidth: (leftSidebarWidth) => set({ leftSidebarWidth }),
			setRightSidebarOpen: (open) => set({ rightSidebarOpen: open }),
			setRightSidebarWidth: (width) => set({ rightSidebarWidth: width }),
			setRightSidebarTab: (tab) => set({ rightSidebarTab: tab, rightSidebarOpen: true }),
			setInterfaceMode: (interfaceMode) => set({ interfaceMode }),
			setSelectedGitFile: (path, staged) =>
				set({ selectedGitFile: path, selectedGitStaged: staged ?? false }),
			setSelectedArtifactPath: (path) => set({ selectedArtifactPath: path }),
			setSelectedArtifactViewMode: (mode) => set({ selectedArtifactViewMode: mode }),
			toggleLeftSidebar: () => set({ leftSidebarOpen: !get().leftSidebarOpen }),
			toggleRightSidebar: () => set({ rightSidebarOpen: !get().rightSidebarOpen }),
			toggleInterfaceMode: () =>
				set({ interfaceMode: get().interfaceMode === "simple" ? "advanced" : "simple" }),
		}),
		{
			name: "a-coder-desktop-ui",
			version: 1,
			migrate: (persisted) => {
				const state = (persisted ?? {}) as Partial<UiState>;
				// Older persisted states used tabs like "html" / "markdown" that no longer exist.
				if (
					state.rightSidebarTab !== "files" &&
					state.rightSidebarTab !== "git" &&
					state.rightSidebarTab !== "activity"
				) {
					state.rightSidebarTab = "files";
				}
				return state as UiState;
			},
			partialize: (state) => ({
				leftSidebarOpen: state.leftSidebarOpen,
				leftSidebarSection: state.leftSidebarSection,
				leftSidebarWidth: state.leftSidebarWidth,
				rightSidebarOpen: state.rightSidebarOpen,
				rightSidebarWidth: state.rightSidebarWidth,
				rightSidebarTab: state.rightSidebarTab,
				interfaceMode: state.interfaceMode,
			}),
		},
	),
);
