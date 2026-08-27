import { create } from "zustand";

/**
 * Per-session composer drafts — hermes-style. Switching sessions keeps each
 * session's unsent text separately, so a half-written message in one session
 * doesn't leak into (or get lost when returning to) another. Keyed by session
 * file path.
 */

interface DraftsState {
	drafts: Record<string, string>;
	saveDraft: (sessionFile: string, text: string) => void;
	takeDraft: (sessionFile: string) => string | undefined;
}

export const useDraftStore = create<DraftsState>((set, get) => ({
	drafts: {},
	saveDraft: (sessionFile, text) =>
		set((s) => {
			if (s.drafts[sessionFile] === text) return s;
			return { drafts: { ...s.drafts, [sessionFile]: text } };
		}),
	takeDraft: (sessionFile) => {
		const draft = get().drafts[sessionFile];
		if (draft !== undefined) {
			set((s) => {
				const { [sessionFile]: _removed, ...rest } = s.drafts;
				return { drafts: rest };
			});
		}
		return draft;
	},
}));