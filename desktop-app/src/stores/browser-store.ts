// Browser panel store: tabs, the active tab, download approvals, captures.
// The Rust side owns the truth (views, URLs, titles); this mirrors it and
// drives it through commands.

import { create } from "zustand";
import browser, { onBrowserEvent, type BrowserEvent, type TabInfo } from "../lib/browser";
import { openExternalLink } from "../lib/external-link";
import { useUiStore } from "./ui-store";

export interface BrowserTab {
	id: string;
	url: string;
	title: string;
	loading: boolean;
	back: boolean;
	muted: boolean;
	/** The last capture, as an object URL, shown until dismissed. */
	captureUrl?: string;
	/** Zoom for the tab's view, forwarded on activation. */
	zoom: number;
}

export interface DownloadPrompt {
	id: string;
	tabId: string;
	url: string;
	site: string;
	name: string;
}

interface BrowserState {
	open: boolean;
	supported: boolean;
	/** The proxied-frame gateway origin, on platforms without native views. */
	gateway: string | null;
	layered: boolean;
	captureSupported: boolean;
	tabs: BrowserTab[];
	activeId: string | null;
	downloads: DownloadPrompt[];
	initialized: boolean;
	/** An agent tool asked for a tab while the panel was closed. */
	pendingUrl: string | null;

	setOpen: (open: boolean) => void;
	init: () => Promise<void>;
	openTab: (url: string) => Promise<void>;
	activate: (tabId: string) => Promise<void>;
	navigate: (tabId: string, url: string) => Promise<void>;
	action: (tabId: string, action: string) => Promise<void>;
	setZoom: (tabId: string, delta: number) => Promise<void>;
	setMuted: (tabId: string, muted: boolean) => Promise<void>;
	close: (tabId: string) => Promise<void>;
	find: (query: string, backwards: boolean) => Promise<void>;
	capture: (tabId: string) => Promise<void>;
	captureRegion: (bounds: {
		x: number;
		y: number;
		width: number;
		height: number;
		viewportWidth: number;
	}) => Promise<void>;
	dismissCapture: (tabId: string) => void;
	decideDownload: (id: string, action: "save" | "open" | "reveal" | "cancel") => Promise<void>;
	/** Applies one Rust event; bound once at startup. */
	applyEvent: (event: BrowserEvent) => void;
}

const normalizeUrl = (input: string): string | null => {
	const trimmed = input.trim();
	if (!trimmed) return null;
	const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
	try {
		const url = new URL(withScheme);
		if (url.protocol !== "http:" && url.protocol !== "https:") return null;
		return url.toString();
	} catch {
		return null;
	}
};

export const useBrowserStore = create<BrowserState>((set, get) => ({
	open: false,
	supported: false,
	gateway: null,
	layered: false,
	captureSupported: false,
	tabs: [],
	activeId: null,
	downloads: [],
	initialized: false,
	pendingUrl: null,

	setOpen: (open) => set({ open }),

	init: async () => {
		if (get().initialized) return;
		set({ initialized: true });
		const supported = await browser.supported().catch(() => false);
		const layered = supported ? await browser.layered().catch(() => false) : false;
		const captureSupported = await browser.captureSupported().catch(() => false);
		const gateway = (await browser.gatewayUrl().catch(() => null)) ?? null;
		const tabs: BrowserTab[] = supported
			? (await browser.tabList().catch(() => []) as TabInfo[]).map((info) => ({
					id: info.tabId,
					url: info.url ?? "",
					title: info.title,
					loading: false,
					back: false,
					muted: false,
					zoom: 1,
				}))
			: [];
		set({ supported, gateway, layered, captureSupported, tabs, activeId: tabs[0]?.id ?? null });
		void bindFrameMessages(gateway);
	},

	openTab: async (url) => {
		if (!get().supported) {
			await openExternalLink(url);
			return;
		}
		const tabId = await browser.openTab({ url });
		set((state) => ({
			tabs: [
				...state.tabs,
				{
					id: tabId,
					url,
					title: url,
					loading: true,
					back: false,
					muted: false,
					zoom: 1,
				},
			],
			activeId: tabId,
		}));
	},

	activate: async (tabId) => {
		set({ activeId: tabId });
	},

	navigate: async (tabId, input) => {
		const url = normalizeUrl(input);
		if (!url) return;
		set((state) => ({
			tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, url, loading: true } : tab)),
		}));
		await browser.navigate(tabId, url).catch(() => {});
	},

	action: async (tabId, action) => {
		await browser.action(tabId, action).catch(() => {});
		if (action === "reload") {
			set((state) => ({
				tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, loading: true } : tab)),
			}));
		}
	},

	setZoom: async (tabId, zoom) => {
		await browser.setZoom(tabId, zoom).catch(() => {});
		set((state) => ({
			tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, zoom } : tab)),
		}));
	},

	setMuted: async (tabId, muted) => {
		await browser.setMuted(tabId, muted).catch(() => {});
		set((state) => ({
			tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, muted } : tab)),
		}));
	},

	close: async (tabId) => {
		set((state) => ({
			tabs: state.tabs.filter((tab) => tab.id !== tabId),
			activeId: state.activeId === tabId ? (state.tabs.find((tab) => tab.id !== tabId)?.id ?? null) : state.activeId,
		}));
		await browser.close(tabId).catch(() => {});
	},

	find: async (query, backwards) => {
		const tabId = get().activeId;
		if (!tabId || !query) return;
		await browser.find(tabId, query, backwards).catch(() => {});
	},

	capture: async (tabId) => {
		if (!get().captureSupported) return;
		const png = await browser.capture(tabId).catch(() => null);
		if (!png) return;
		const blob = toBlob(png);
		const url = blob ? URL.createObjectURL(blob) : undefined;
		set((state) => ({
			tabs: state.tabs.map((tab) =>
				tab.id === tabId ? { ...tab, captureUrl: url ?? tab.captureUrl } : tab,
			),
		}));
	},

	captureRegion: async (bounds) => {
		if (!get().captureSupported) return;
		const png = await browser.captureRegion(bounds).catch(() => null);
		if (!png) return;
		const blob = toBlob(png);
		const url = blob ? URL.createObjectURL(blob) : undefined;
		const tabId = get().activeId;
		if (!tabId) return;
		set((state) => ({
			tabs: state.tabs.map((tab) =>
				tab.id === tabId ? { ...tab, captureUrl: url ?? tab.captureUrl } : tab,
			),
		}));
	},

	dismissCapture: (tabId) => {
		set((state) => ({
			tabs: state.tabs.map((tab) => {
				if (tab.id !== tabId) return tab;
				if (tab.captureUrl) URL.revokeObjectURL(tab.captureUrl);
				return { ...tab, captureUrl: undefined };
			}),
		}));
	},

	decideDownload: async (id, action) => {
		const result = await browser.downloadDecide(id, action).catch(() => null);
		if (action === "open" && result) {
			void browser.downloadOpen(result).catch(() => {});
		}
		if (action === "reveal" && result) {
			void browser.downloadReveal(result).catch(() => {});
		}
		set((state) => ({ downloads: state.downloads.filter((prompt) => prompt.id !== id) }));
	},

	applyEvent: (event) => {
		const state = get();
		switch (event.type) {
			case "load":
				set({
					tabs: state.tabs.map((tab) =>
						tab.id === event.tabId ? { ...tab, url: event.url, loading: event.started } : tab,
					),
				});
				break;
			case "title":
				set({
					tabs: state.tabs.map((tab) => (tab.id === event.tabId ? { ...tab, title: event.title } : tab)),
				});
				break;
			case "url":
				set({
					tabs: state.tabs.map((tab) => (tab.id === event.tabId ? { ...tab, url: event.url } : tab)),
				});
				break;
			case "history":
				set({
					tabs: state.tabs.map((tab) => (tab.id === event.tabId ? { ...tab, back: event.back } : tab)),
				});
				break;
			case "external": {
				openExternalLink(event.url);
				break;
			}
			case "newTab":
				void state.openTab(event.url);
				break;
			case "openPanel": {
				// An agent tool wants a page: bring the right rail up on the
				// browser tab; the panel opens tabs only once its bounds are
				// known.
				const ui = useUiStore.getState();
				ui.setRightSidebarOpen(true);
				ui.setRightSidebarTab("browser");
				set({ open: true, pendingUrl: event.url });
				break;
			}
			case "closed":
				set({
					tabs: state.tabs.filter((tab) => tab.id !== event.tabId),
					activeId: state.activeId === event.tabId ? null : state.activeId,
				});
				break;
			case "downloadPrompt":
				if (state.downloads.length >= 5) return;
				set({ downloads: [...state.downloads, event] });
				break;
			case "downloadSettled":
				set({ downloads: state.downloads.filter((prompt) => prompt.id !== event.id) });
				break;
		}
	},
}));

/**
 * Reading-frame pages (Linux / macOS < 14) report their address and title by
 * postMessage from the gateway's sentinel script. The frame is a sandboxed
 * opaque origin, so nothing else can be trusted from it — and nothing reads it.
 */
function bindFrameMessages(gateway: string | null) {
	if (!gateway) return;
	window.addEventListener("message", (event) => {
		if (typeof event.data !== "string" || !event.data.startsWith("{")) return;
		let parsed: { type?: string; href?: unknown; title?: unknown };
		try {
			parsed = JSON.parse(event.data);
		} catch {
			return;
		}
		if (parsed?.type !== "a-coder-frame") return;
		const href = typeof parsed.href === "string" ? parsed.href : null;
		const title = typeof parsed.title === "string" ? parsed.title : "";
		if (!href) return;
		const state = useBrowserStore.getState();
		const tabId = state.activeId;
		if (!tabId) return;
		useBrowserStore.setState({
			tabs: state.tabs.map((tab) =>
				tab.id === tabId
					? { ...tab, url: href, title: title || tab.title, loading: false }
					: tab,
			),
		});
	});
}

function toBlob(png: ArrayBuffer | number[]): Blob | null {
	if (png instanceof ArrayBuffer) return new Blob([png], { type: "image/png" });
	if (Array.isArray(png)) return new Blob([new Uint8Array(png)], { type: "image/png" });
	return null;
}

void browser;

// Bind the event channel once at module load; the store exists before React.
let bound = false;
if (!bound) {
	bound = true;
	void useBrowserStore
		.getState()
		.init()
		.then(() =>
			onBrowserEvent((event) => useBrowserStore.getState().applyEvent(event)),
		);
}