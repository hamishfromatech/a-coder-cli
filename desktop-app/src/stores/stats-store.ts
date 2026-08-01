import { create } from "zustand";

export interface TokenStats {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	total: number;
}

export interface SessionStats {
	sessionId: string;
	sessionFile?: string;
	userMessages: number;
	assistantMessages: number;
	toolCalls: number;
	toolResults: number;
	totalMessages: number;
	tokens: TokenStats;
	cost: number;
}

export interface StatsState {
	stats: SessionStats | null;
	setStats: (stats: SessionStats | null) => void;
}

export const useStatsStore = create<StatsState>((set) => ({
	stats: null,
	setStats: (stats) => set({ stats }),
}));
