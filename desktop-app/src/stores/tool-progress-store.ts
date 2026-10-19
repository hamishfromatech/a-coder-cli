/**
 * Live tool output for `tool-progress` capable clients. Streams are keyed by
 * toolCallId and bounded; the authoritative result still replaces them when the
 * toolResult message lands.
 */

import { create } from "zustand";

const MAX_STREAM_CHARS = 64 * 1024;

export interface ToolStream {
	toolName: string;
	stdout: string;
	stderr: string;
	ended: boolean;
	isError: boolean;
}

interface ToolProgressState {
	streams: Record<string, ToolStream>;
	start: (toolCallId: string, toolName: string) => void;
	append: (toolCallId: string, stream: "stdout" | "stderr", delta: string, reset?: boolean) => void;
	end: (toolCallId: string, isError: boolean) => void;
	clear: () => void;
}

function bounded(previous: string, delta: string, reset: boolean): string {
	const next = reset ? delta : previous + delta;
	return next.length > MAX_STREAM_CHARS ? next.slice(-MAX_STREAM_CHARS) : next;
}

export const useToolProgressStore = create<ToolProgressState>((set) => ({
	streams: {},
	start: (toolCallId, toolName) =>
		set((state) => ({
			streams: {
				...state.streams,
				[toolCallId]: { toolName, stdout: "", stderr: "", ended: false, isError: false },
			},
		})),
	append: (toolCallId, stream, delta, reset = false) =>
		set((state) => {
			const current = state.streams[toolCallId];
			if (!current) return state;
			return {
				streams: {
					...state.streams,
					[toolCallId]: {
						...current,
						[stream]: bounded(current[stream], delta, reset),
					},
				},
			};
		}),
	end: (toolCallId, isError) =>
		set((state) => {
			const current = state.streams[toolCallId];
			if (!current) return state;
			return { streams: { ...state.streams, [toolCallId]: { ...current, ended: true, isError } } };
		}),
	clear: () => set({ streams: {} }),
}));
