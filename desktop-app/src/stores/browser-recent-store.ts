// Recent pages for the browser's start surface: finished loads only, newest
// first, one row per URL. Persisted so a restart still offers the pages the
// user was reading; live tabs stay in the browser store.

import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface RecentPage {
	url: string;
	title: string;
	at: number;
}

interface BrowserRecentState {
	pages: RecentPage[];
	record: (url: string, title: string) => void;
	clear: () => void;
}

const MAX_RECENT_PAGES = 60;

/** http(s) only: the start surface never offers scheme or file handoffs. */
export function webUrl(raw: string): string | null {
	try {
		const url = new URL(raw);
		return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
	} catch {
		return null;
	}
}

export const useBrowserRecentStore = create<BrowserRecentState>()(
	persist(
		(set, get) => ({
			pages: [],
			record: (url, title) => {
				const clean = webUrl(url);
				if (!clean) return;
				const host = new URL(clean).host;
				const page: RecentPage = {
					url: clean,
					title: title.trim() || host,
					at: Date.now(),
				};
				set({
					pages: [page, ...get().pages.filter((entry) => entry.url !== clean)].slice(
						0,
						MAX_RECENT_PAGES,
					),
				});
			},
			clear: () => set({ pages: [] }),
		}),
		{ name: "a-coder-desktop-browser-recent", version: 1 },
	),
);
