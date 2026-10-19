/**
 * Per-session view state: scroll anchor and expanded tool rows. Keyed by
 * session file so switching tabs restores what the user was looking at.
 */

import { create } from "zustand";

interface SessionViewState {
	scroll: Record<string, number>;
	expanded: Record<string, string[]>;
	setScroll: (sessionFile: string, scrollTop: number) => void;
	setToolExpanded: (sessionFile: string, toolCallId: string, expanded: boolean) => void;
}

export const useSessionViewStore = create<SessionViewState>((set) => ({
	scroll: {},
	expanded: {},
	setScroll: (sessionFile, scrollTop) =>
		set((state) =>
			state.scroll[sessionFile] === scrollTop
				? state
				: { scroll: { ...state.scroll, [sessionFile]: scrollTop } },
		),
	setToolExpanded: (sessionFile, toolCallId, expanded) =>
		set((state) => {
			const current = state.expanded[sessionFile] ?? [];
			const has = current.includes(toolCallId);
			if (expanded === has) return state;
			const next = expanded ? [...current, toolCallId] : current.filter((id) => id !== toolCallId);
			return { expanded: { ...state.expanded, [sessionFile]: next } };
		}),
}));
