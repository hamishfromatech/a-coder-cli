/**
 * Client-side transcripts for detached (background) sessions. Active sessions
 * still use the main session store; this map keeps subscribed background turns
 * live so switching to a tab paints the finished transcript instantly and
 * unread state can be badged.
 */

import { create } from "zustand";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

const MAX_TRANSCRIPTS = 8;

export interface BackgroundTranscript {
	messages: AgentMessage[];
	total: number;
	start: number;
	hasMoreOlder: boolean;
	running: boolean;
	unread: number;
	lastActivity: number;
}

interface SessionTranscriptsState {
	transcripts: Record<string, BackgroundTranscript>;
	subscribed: Record<string, true>;
	update: (sessionFile: string, updater: (previous: BackgroundTranscript) => BackgroundTranscript) => void;
	setSubscribed: (sessionFile: string, subscribed: boolean) => void;
	markRead: (sessionFile: string) => void;
	drop: (sessionFile: string) => void;
}

const empty = (): BackgroundTranscript => ({
	messages: [],
	total: 0,
	start: 0,
	hasMoreOlder: false,
	running: false,
	unread: 0,
	lastActivity: 0,
});

export const useSessionTranscriptsStore = create<SessionTranscriptsState>((set) => ({
	transcripts: {},
	subscribed: {},
	update: (sessionFile, updater) =>
		set((state) => {
			const previous = state.transcripts[sessionFile] ?? empty();
			const transcripts = { ...state.transcripts, [sessionFile]: updater(previous) };
			const keys = Object.keys(transcripts);
			if (keys.length > MAX_TRANSCRIPTS) {
				// Evict the least recently active transcript that is not subscribed.
				const victim = keys
					.filter((key) => !state.subscribed[key])
					.sort((a, b) => (transcripts[a]?.lastActivity ?? 0) - (transcripts[b]?.lastActivity ?? 0))[0];
				if (victim) delete transcripts[victim];
			}
			return { transcripts };
		}),
	setSubscribed: (sessionFile, subscribed) =>
		set((state) => {
			const next = { ...state.subscribed };
			if (subscribed) next[sessionFile] = true;
			else delete next[sessionFile];
			return { subscribed: next };
		}),
	markRead: (sessionFile) =>
		set((state) => {
			const previous = state.transcripts[sessionFile];
			if (!previous || previous.unread === 0) return state;
			return { transcripts: { ...state.transcripts, [sessionFile]: { ...previous, unread: 0 } } };
		}),
	drop: (sessionFile) =>
		set((state) => {
			const { [sessionFile]: _removed, ...transcripts } = state.transcripts;
			const { [sessionFile]: _subscribed, ...subscribed } = state.subscribed;
			return { transcripts, subscribed };
		}),
}));
