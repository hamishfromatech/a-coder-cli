/**
 * Live tool output for `tool-progress` capable clients. Streams are keyed by
 * toolCallId and bounded; the authoritative result still replaces them when the
 * toolResult message lands.
 */

import { create } from "zustand";

const MAX_STREAM_CHARS = 64 * 1024;

export interface ToolProgressMeta {
	progress: number;
	total?: number;
	percent?: number;
	message?: string;
}

export interface ToolStream {
	toolName: string;
	stdout: string;
	stderr: string;
	ended: boolean;
	isError: boolean;
	/** Latest MCP `notifications/progress` for this call. */
	progress?: ToolProgressMeta;
}

interface ToolProgressState {
	streams: Record<string, ToolStream>;
	start: (toolCallId: string, toolName: string) => void;
	append: (toolCallId: string, stream: "stdout" | "stderr", delta: string, reset?: boolean) => void;
	end: (toolCallId: string, isError: boolean) => void;
	setProgress: (toolCallId: string, toolName: string, progress: ToolProgressMeta) => void;
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
	setProgress: (toolCallId, toolName, progress) =>
		set((state) => {
			const current = state.streams[toolCallId];
			return {
				streams: {
					...state.streams,
					[toolCallId]: {
						toolName: current?.toolName ?? toolName,
						stdout: current?.stdout ?? "",
						stderr: current?.stderr ?? "",
						ended: current?.ended ?? false,
						isError: current?.isError ?? false,
						progress,
					},
				},
			};
		}),
	clear: () => set({ streams: {} }),
}));

/** `42% · refining mesh` — the trailing meta for a running tool row. */
export function formatToolProgress(progress: ToolProgressMeta | undefined): string {
	if (!progress) return "";
	return [
		typeof progress.percent === "number" ? `${progress.percent}%` : "",
		progress.message ?? "",
	]
		.filter(Boolean)
		.join(" · ");
}
