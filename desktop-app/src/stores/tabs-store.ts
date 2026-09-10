import { create } from "zustand";

export interface SessionTab {
	/** Session file path — the `switchSession` target. */
	path: string;
	name: string;
}

export interface TabsState {
	tabs: SessionTab[];
	activePath: string | null;
	/** Ensure a tab exists for this session and mark it active. When `name` is
	 *  provided the tab's label is updated (renames + new sessions); when
	 *  omitted an existing tab keeps its current label — used while the engine
	 *  name for the newly activated session is not yet authoritative. */
	openTab: (path: string, name?: string) => void;
	/** Remove a tab. Returns the path to activate next when the closed tab was
	 *  active, otherwise null (no switch needed). */
	closeTab: (path: string) => string | null;
	setActive: (path: string) => void;
	renameTab: (path: string, name: string) => void;
	clear: () => void;
}

export const useTabsStore = create<TabsState>((set, get) => ({
	tabs: [],
	activePath: null,
	openTab: (path, name) =>
		set((s) => {
			const idx = s.tabs.findIndex((t) => t.path === path);
			const tabs = [...s.tabs];
			const existing = idx >= 0 ? tabs[idx] : undefined;
			const label =
				name !== undefined
					? name || "Untitled session"
					: (existing?.name ?? "Untitled session");
			if (idx >= 0) {
				tabs[idx] = { path, name: label };
			} else {
				tabs.push({ path, name: label });
			}
			return { tabs, activePath: path };
		}),
	closeTab: (path) => {
		const { tabs, activePath } = get();
		const idx = tabs.findIndex((t) => t.path === path);
		if (idx < 0) return null;
		const wasActive = activePath === path;
		const next = tabs.filter((t) => t.path !== path);
		let nextActive = activePath;
		if (wasActive) {
			const neighbor = next[idx] ?? next[idx - 1] ?? null;
			nextActive = neighbor ? neighbor.path : null;
		}
		set({ tabs: next, activePath: nextActive });
		return wasActive ? nextActive : null;
	},
	setActive: (path) => set({ activePath: path }),
	renameTab: (path, name) =>
		set((s) => ({
			tabs: s.tabs.map((t) =>
				t.path === path ? { ...t, name: name || t.name } : t,
			),
		})),
	clear: () => set({ tabs: [], activePath: null }),
}));