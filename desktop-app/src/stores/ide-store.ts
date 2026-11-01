import { create } from "zustand";
import { persist } from "zustand/middleware";

/** One open editor tab. `lastSaved` is the on-disk content when the tab was
 * last saved ("" when unread); dirty = model value !== lastSaved. */
export interface IdeTab {
	path: string;
	/** Content snapshot at last save/load — the dirty check compares against it. */
	lastSaved: string;
}

export type IdeSidebarTab = "explorer" | "git" | "search" | null;

/** Jump-to-line request from a search result; nonce forces refiring. */
export interface IdeRevealRequest {
	path: string;
	line: number;
	nonce: number;
}

export interface IdeState {
	openTabs: IdeTab[];
	activePath: string | null;
	sidebarTab: IdeSidebarTab;
	sidebarWidth: number;
	terminalOpen: boolean;
	terminalHeight: number;
	/** Expanded folders per workspace root, so a restart keeps the tree shape. */
	explorerExpanded: Record<string, string[]>;
	setExplorerExpanded: (root: string, paths: string[]) => void;
	/** Editor preferences, persisted so a restart keeps the working setup. */
	editorFontSize: number;
	editorMinimap: boolean;
	editorWordWrap: boolean;
	editorRenderWhitespace: boolean;
	/** Consumed by the editor group; the editor clears it after revealing. */
	pendingReveal: IdeRevealRequest | null;

	openFile: (path: string, content: string) => void;
	closeTab: (path: string) => void;
	setActive: (path: string) => void;
	setSaved: (path: string, content: string) => void;
	setSidebarTab: (tab: IdeSidebarTab) => void;
	setSidebarWidth: (width: number) => void;
	setTerminalOpen: (open: boolean) => void;
	setTerminalHeight: (height: number) => void;
	setEditorFontSize: (size: number) => void;
	setEditorMinimap: (enabled: boolean) => void;
	setEditorWordWrap: (enabled: boolean) => void;
	setEditorRenderWhitespace: (enabled: boolean) => void;
	/** Drag reorder in the editor tab strip. */
	moveTab: (path: string, beforePath: string) => void;
	setPendingReveal: (request: IdeRevealRequest | null) => void;
}

export const useIdeStore = create<IdeState>()(
	persist(
		(set, get) => ({
			openTabs: [],
			activePath: null,
			sidebarTab: "explorer" as IdeSidebarTab,
			sidebarWidth: 264,
			terminalOpen: true,
			terminalHeight: 260,
			explorerExpanded: {},
			setExplorerExpanded: (root, paths) =>
				set((state) => ({ explorerExpanded: { ...state.explorerExpanded, [root]: paths } })),
			editorFontSize: 13,
			editorMinimap: true,
			editorWordWrap: false,
			editorRenderWhitespace: false,
			pendingReveal: null,

			openFile: (path, content) => {
				const openTabs = get().openTabs;
				const existing = openTabs.find((tab) => tab.path === path);
				if (existing) {
					// Already open: just focus (content may have changed on disk).
					set({ activePath: path });
					return;
				}
				set({ openTabs: [...openTabs, { path, lastSaved: content }], activePath: path });
			},
			closeTab: (path) => {
				const openTabs = get().openTabs;
				const next = openTabs.filter((tab) => tab.path !== path);
				const activePath = get().activePath;
				set({
					openTabs: next,
					activePath: activePath === path ? (next.at(-1)?.path ?? null) : activePath,
				});
			},
			setActive: (path) => set({ activePath: path }),
			setSaved: (path, content) =>
				set({
					openTabs: get().openTabs.map((tab) => (tab.path === path ? { ...tab, lastSaved: content } : tab)),
				}),
			setSidebarTab: (sidebarTab) => set({ sidebarTab }),
			setSidebarWidth: (sidebarWidth) => set({ sidebarWidth }),
			setTerminalOpen: (terminalOpen) => set({ terminalOpen }),
			setTerminalHeight: (terminalHeight) => set({ terminalHeight }),
			setEditorFontSize: (editorFontSize) =>
				set({ editorFontSize: Math.min(22, Math.max(10, editorFontSize)) }),
			setEditorMinimap: (editorMinimap) => set({ editorMinimap }),
			setEditorWordWrap: (editorWordWrap) => set({ editorWordWrap }),
			setEditorRenderWhitespace: (editorRenderWhitespace) => set({ editorRenderWhitespace }),
			moveTab: (path, beforePath) =>
				set((state) => {
					const from = state.openTabs.findIndex((tab) => tab.path === path);
					const to = state.openTabs.findIndex((tab) => tab.path === beforePath);
					if (from < 0 || to < 0 || from === to) return state;
					const openTabs = [...state.openTabs];
					const [moved] = openTabs.splice(from, 1);
					openTabs.splice(from < to ? to - 1 : to, 0, moved);
					return { openTabs };
				}),
			setPendingReveal: (pendingReveal) => set({ pendingReveal }),
		}),
		{
			name: "a-coder-desktop-ide",
			version: 1,
			partialize: (state) => ({
				openTabs: state.openTabs,
				sidebarTab: state.sidebarTab,
				sidebarWidth: state.sidebarWidth,
				terminalOpen: state.terminalOpen,
				terminalHeight: state.terminalHeight,
				explorerExpanded: state.explorerExpanded,
				editorFontSize: state.editorFontSize,
				editorMinimap: state.editorMinimap,
				editorWordWrap: state.editorWordWrap,
				editorRenderWhitespace: state.editorRenderWhitespace,
			}),
		},
	),
);