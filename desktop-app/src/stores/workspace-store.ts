import { create } from "zustand";
import { persist } from "zustand/middleware";

const MAX_RECENT = 10;

export interface WorkspaceState {
	current: string;
	recentProjects: string[];
	setCurrent: (path: string) => void;
	addRecent: (path: string) => void;
	removeRecent: (path: string) => void;
	clearRecent: () => void;
}

function normalizePath(path: string): string {
	return path.trim().replace(/\/$/, "");
}

export const useWorkspaceStore = create<WorkspaceState>()(
	persist(
		(set, get) => ({
			current: "",
			recentProjects: [],
			setCurrent: (path) => {
				const normalized = normalizePath(path);
				get().addRecent(normalized);
				set({ current: normalized });
			},
			addRecent: (path) => {
				const normalized = normalizePath(path);
				if (!normalized) return;
				set((state) => {
					const without = state.recentProjects.filter((p) => p !== normalized);
					return {
						recentProjects: [normalized, ...without].slice(0, MAX_RECENT),
					};
				});
			},
			removeRecent: (path) => {
				set((state) => ({
					recentProjects: state.recentProjects.filter((p) => p !== path),
				}));
			},
			clearRecent: () => set({ recentProjects: [] }),
		}),
		{ name: "a-coder-desktop-workspaces" },
	),
);
