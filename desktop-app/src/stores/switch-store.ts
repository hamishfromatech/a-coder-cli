/**
 * One in-flight workspace/session switch, shared by every entry point.
 *
 * Switching is a single engine operation: while one is in flight, the session
 * tabs, the sidebar rows, the project picker, and the transcript all need to
 * agree on what is happening. Keeping that in one store (instead of a local
 * `pendingPath` per component) is what makes a click on a session row light up
 * the tab strip too, and it is the guard that stops two surfaces from racing
 * `switchSession` against each other.
 */

import { create } from "zustand";

export type SwitchKind = "session" | "project";

export interface SwitchPending {
	kind: SwitchKind;
	/** Session file for a session switch; workspace path for a project switch. */
	path: string;
	/** Display name to show while the switch resolves. */
	name: string | null;
}

interface SwitchState {
	pending: SwitchPending | null;
	/** Claims the switch slot; false when another switch already owns it. */
	begin: (pending: SwitchPending) => boolean;
	/** Releases the slot; with `path`, only when it still belongs to that target. */
	clear: (path?: string) => void;
}

export const useSwitchStore = create<SwitchState>((set, get) => ({
	pending: null,
	begin: (pending) => {
		if (get().pending) return false;
		set({ pending });
		return true;
	},
	clear: (path) => {
		const current = get().pending;
		if (!current) return;
		if (path && current.path !== path) return;
		set({ pending: null });
	},
}));
