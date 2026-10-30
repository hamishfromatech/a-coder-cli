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
			}),
		},
	),
);