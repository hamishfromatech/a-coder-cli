/**
 * Closed tabs stack — recently closed session tabs with re-open capability.
 * Mirrors OpenCode's closed-tabs.ts pattern:
 *   - Push when closing a session tab
 *   - Take when re-opening (Ctrl+Shift+T)
 *   - Limit to 25 entries
 *   - Filter out tabs that are already open
 */

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ClosedSessionTab {
	sessionId: string;
	sessionName: string;
	projectPath: string;
	closedAt: number;
}

interface ClosedTabsState {
	stack: ClosedSessionTab[];
	push: (tab: ClosedSessionTab) => void;
	take: () => ClosedSessionTab | undefined;
	remove: (sessionId: string) => void;
	clear: () => void;
}

const CLOSED_TAB_LIMIT = 25;

export const useClosedTabsStore = create<ClosedTabsState>()(
	persist(
		(set, get) => ({
			stack: [],

			push: (tab) => {
				const { stack } = get();
				// Don't push if already in stack
				if (stack.some((t) => t.sessionId === tab.sessionId)) return;
				// Add to end, trim to limit
				const next = [...stack, tab].slice(-CLOSED_TAB_LIMIT);
				set({ stack: next });
			},

			take: () => {
				const { stack } = get();
				if (stack.length === 0) return undefined;
				const last = stack[stack.length - 1];
				const next = stack.slice(0, -1);
				set({ stack: next });
				return last;
			},

			remove: (sessionId) => {
				set((state) => ({
					stack: state.stack.filter((t) => t.sessionId !== sessionId),
				}));
			},

			clear: () => {
				set({ stack: [] });
			},
		}),
		{
			name: "a-coder-closed-tabs",
			version: 1,
		},
	),
);