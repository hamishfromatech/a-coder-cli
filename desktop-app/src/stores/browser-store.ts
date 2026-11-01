// Browser panel store: tabs, the active tab, download approvals, captures.
// The Rust side owns the truth (views, URLs, titles); this mirrors it and
// drives it through commands.

import { create } from "zustand";
import { persist } from "zustand/middleware";
import browser, { onBrowserEvent, type BrowserEvent, type TabInfo } from "../lib/browser";
import { rendererLog } from "../lib/renderer-log";
import { toast } from "./toast-store";
import { openExternalLink } from "../lib/external-link";
import { readSettingsFile } from "../lib/rpc";
import { triggerHaptic } from "../lib/haptics";
import { useUiStore } from "./ui-store";
import { useBrowserRecentStore } from "./browser-recent-store";
import { moveTabBefore } from "../lib/tab-order";

export interface BrowserTab {
	id: string;
	url: string;
	title: string;
	loading: boolean;
	back: boolean;
	forward: boolean;
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

/** A non-web-scheme URL waiting for the user's yes/no before handoff. */
interface ExternalPrompt {
	id: string;
	url: string;
}

/** The permission gate's parked agent call, shown for a decision. */
export interface AgentAsk {
	id: string;
	tabId: string;
	host: string;
	url: string;
	op: string;
	sensitive: boolean;
}

interface BrowserState {
	open: boolean;
	supported: boolean;
	/** The proxied-frame gateway origin, on platforms without native views. */
	gateway: string | null;
	layered: boolean;
	captureSupported: boolean;
	/** Where external links open: "default" browser or this app's panel. */
	linkTarget: "default" | "desktop";
	tabs: BrowserTab[];
	activeId: string | null;
	downloads: DownloadPrompt[];
	/** Completed downloads this run (newest first), for the settings surface. */
	recentDownloads: Array<{ path: string; at: number }>;
	initialized: boolean;
	/** An agent tool asked for a tab while the panel was closed. */
	pendingUrl: string | null;
	/** A page asked to hand a non-web URL to the system; shown for confirmation. */
	externalPrompt: ExternalPrompt | null;
	/** The gate's parked agent calls, newest first, awaiting a decision. */
	agentAsks: AgentAsk[];
	/** URLs of tabs closed this run, newest first (reopen from the menu). */
	closedUrls: string[];

	setOpen: (open: boolean) => void;
	init: () => Promise<void>;
	/** Opens a tab; no URL opens the start surface instead of a site. */
	openTab: (url?: string) => Promise<void>;
	activate: (tabId: string) => Promise<void>;
	navigate: (tabId: string, url: string) => Promise<void>;
	action: (tabId: string, action: string) => Promise<void>;
	setZoom: (tabId: string, delta: number) => Promise<void>;
	setMuted: (tabId: string, muted: boolean) => Promise<void>;
	close: (tabId: string) => Promise<void>;
	/** Closes every tab except the given one; the kept tab becomes active. */
	closeOthers: (tabId: string) => Promise<void>;
	/** Explicit session end: closes all tabs and consumes the session snapshot. */
	closeAll: () => Promise<void>;
	/** Copies a tab's URL to the clipboard and confirms with a toast. */
	copyUrl: (tabId: string) => Promise<void>;
	/** Restores a persisted session on a fresh panel mount; no-ops once consumed. */
	restoreSession: () => Promise<void>;
	/** Queues a non-web-scheme external handoff for user confirmation. */
	requestExternalConfirm: (url: string) => void;
	/** Resolves the pending handoff; accept hands the URL to the system. */
	decideExternalPrompt: (accept: boolean) => void;
	/** Runs the page's native find; false when the page has no match, null when unavailable. */
	find: (query: string, backwards: boolean) => Promise<boolean | null>;
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
	/** Resolves one parked agent op: allow (optionally remember the host) or deny. */
	decideAgentAsk: (id: string, allow: boolean, remember: boolean) => Promise<void>;
	/** Moves a tab before another in the strip (drag reorder). */
	reorder: (tabId: string, beforeId: string) => void;
	/** Reopens the most recently closed tab, if any. */
	reopenClosed: () => Promise<void>;
	/** Clears the completed-download list (pending approvals stay). */
	clearRecentDownloads: () => void;
	/** Applies one Rust event; bound once at startup. */
	applyEvent: (event: BrowserEvent) => void;
}

/** Normalizes an address-bar entry into an http(s) URL; null when unusable. */
export { normalizeUrl } from "../lib/normalize-url";
import { normalizeUrl } from "../lib/normalize-url";

/** http(s) is what the embedded views can show; anything else (mailto:, tel:, files, app schemes) must leave for the system handler. */
const isWebUrl = (url: string): boolean => {
	try {
		const parsed = new URL(url);
		return parsed.protocol === "https:" || parsed.protocol === "http:";
	} catch {
		return false;
	}
};

// Session restore: the open tabs' URLs (strip order) plus the active tab, so
// a fresh app run can bring the session back when the panel mounts. The
// persisted `restored` flag marks the snapshot consumed — a replayed restore
// or an explicitly closed session never comes back mid-run.
const MAX_SESSION_TABS = 20;
/** Closed-tab memory for the reopen command; deep enough for a burst. */
const MAX_CLOSED_TABS = 10;

/** Panel-only id for a start tab (no native view exists until it navigates). */
function startTabId(): string {
	return `start-${crypto.randomUUID().slice(0, 8)}`;
}

interface BrowserSessionSnapshot {
	/** Open-tab URLs in strip order, capped. */
	urls: string[];
	/** URL of the snapshot-time active tab, when one was active. */
	activeUrl: string | null;
}

interface BrowserSessionState {
	snapshot: BrowserSessionSnapshot | null;
	/** Consumed marker: restored once this run, or the session ended. */
	restored: boolean;
	setSnapshot: (snapshot: BrowserSessionSnapshot | null) => void;
	markRestored: () => void;
}

export const useBrowserSessionStore = create<BrowserSessionState>()(
	persist(
		(set) => ({
			snapshot: null,
			restored: false,
			setSnapshot: (snapshot) => set({ snapshot }),
			markRestored: () => set({ restored: true }),
		}),
		{
			name: "a-coder-desktop-browser-session",
			// A new run starts un-restored: never let the previous run's marker
			// (restored once, or a close-all) survive into it. Actions are not
			// persisted; only the data fields rehydrate.
			merge: (persisted, current) => {
				const saved = (persisted ?? {}) as Partial<BrowserSessionState>;
				return {
					...current,
					snapshot: saved.snapshot ?? current.snapshot,
					restored: false,
				};
			},
		},
	),
);

/** True once this run has held tabs; separates a real close-all from the
    startup pass the panel takes before init has listed anything. */
let sessionLive = false;

/** Mirrors the store's tabs into the persisted session snapshot. */
function syncSessionSnapshot(state: BrowserState): void {
	if (!(state.supported || state.gateway)) return;
	const session = useBrowserSessionStore.getState();
	if (state.tabs.length > 0) {
		sessionLive = true;
		session.setSnapshot({
			urls: state.tabs.slice(0, MAX_SESSION_TABS).map((tab) => tab.url).filter(Boolean),
			activeUrl: state.tabs.find((tab) => tab.id === state.activeId)?.url ?? null,
		});
		return;
	}
	// Tab list drained: only a run that had tabs is ending a session — the
	// tabless state before init must not wipe what the last run left behind.
	if (sessionLive) {
		sessionLive = false;
		session.setSnapshot(null);
		session.markRestored();
	}
}

export const useBrowserStore = create<BrowserState>((set, get) => ({
	open: false,
	supported: false,
	gateway: null,
	layered: false,
	captureSupported: false,
	/** Where chat/panel external links open: the system default or this app's
	 *  browser panel. Hydrated from the CLI settings' browser.linkTarget at
	 *  boot; the settings widget writes both sides. */
	linkTarget: "default" as "default" | "desktop",
	tabs: [],
	activeId: null,
	downloads: [],
	recentDownloads: [],
	initialized: false,
	pendingUrl: null,
	externalPrompt: null,
	agentAsks: [],
	closedUrls: [],

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
					forward: false,
					muted: false,
					zoom: 1,
				}))
			: [];
		set({ supported, gateway, layered, captureSupported, tabs, activeId: tabs[0]?.id ?? null });
		void bindFrameMessages(gateway);
	},

	openTab: async (url) => {
		const target = (url ?? "").trim();
		const start = target.length === 0;
		// Start tabs live only in the panel until the first address: the native
		// view is created by the panel's bounds pass once a URL exists, so no
		// blank page ever covers the start surface.
		if (!get().supported) {
			// Gateways render reading frames; without one the system browser is
			// the only way to see a page.
			const tabId = start
				? startTabId()
				: get().gateway
					? `frame-${crypto.randomUUID().slice(0, 8)}`
					: startTabId();
			if (!start && !get().gateway) {
				await openExternalLink(target);
				return;
			}
			set((state) => ({
				tabs: [
					...state.tabs,
					{
						id: tabId,
						url: target,
						title: start ? "" : target,
						loading: false,
						back: false,
						forward: false,
						muted: false,
						zoom: 1,
					},
				],
				activeId: tabId,
			}));
			return;
		}
		if (start) {
			const tabId = startTabId();
			set((state) => ({
				tabs: [
					...state.tabs,
					{
						id: tabId,
						url: "",
						title: "",
						loading: false,
						back: false,
						forward: false,
						muted: false,
						zoom: 1,
					},
				],
				activeId: tabId,
			}));
			return;
		}
		const tabId = await browser.openTab({ url: target }).catch((error) => {
			rendererLog(`browser: openTab failed: ${String(error)}`);
			throw error;
		});
		set((state) => ({
			tabs: [
				...state.tabs,
				{
					id: tabId,
					url: target,
					title: target,
					loading: true,
					back: false,
					forward: false,
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
		if (!get().supported && !get().gateway) {
			await openExternalLink(url, { forceDefault: true });
			return;
		}
		const current = get().tabs.find((tab) => tab.id === tabId);
		const frameTab = tabId.startsWith("frame-");
		// A start tab has no native view yet; the panel creates one at the new
		// address when it next measures the page area. Reading frames never
		// report loads, so they must not sit on a spinner.
		const startTab = current?.url === "";
		const pendingLoad = !frameTab && get().supported;
		set((state) => ({
			tabs: state.tabs.map((tab) =>
				tab.id === tabId
					? { ...tab, url, title: frameTab ? url : "", loading: pendingLoad }
					: tab,
			),
		}));
		// Frame tabs (unsupported platforms) are pure frontend: the iframe's
		// src follows the URL; the sentinel reports loads back.
		if (frameTab || startTab) return;
		await browser.navigate(tabId, url).catch(() => {});
	},

	action: async (tabId, action) => {
		await browser.action(tabId, action).catch(() => {});
		const optimistic =
			action === "reload"
				? { loading: true }
				: action === "stop"
					? { loading: false }
					: null;
		if (optimistic) {
			set((state) => ({
				tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, ...optimistic } : tab)),
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
		const closing = get().tabs.find((tab) => tab.id === tabId);
		set((state) => ({
			tabs: state.tabs.filter((tab) => tab.id !== tabId),
			activeId: state.activeId === tabId ? (state.tabs.find((tab) => tab.id !== tabId)?.id ?? null) : state.activeId,
			closedUrls: closing?.url
				? [closing.url, ...state.closedUrls].slice(0, MAX_CLOSED_TABS)
				: state.closedUrls,
		}));
		await browser.close(tabId).catch(() => {});
	},

	// Rust tabs close by command; frame tabs (unsupported platforms) are pure
	// frontend state and just drop out of the list.
	closeOthers: async (tabId) => {
		const kept = get().tabs.find((tab) => tab.id === tabId);
		if (!kept) return;
		const others = get().tabs.filter((tab) => tab.id !== tabId);
		set({ tabs: [kept], activeId: kept.id });
		for (const tab of others) {
			if (tab.id.startsWith("frame-")) continue;
			await browser.close(tab.id).catch(() => {});
		}
	},

	closeAll: async () => {
		const all = get().tabs;
		const urls = [...all].reverse().map((tab) => tab.url).filter(Boolean);
		set((state) => ({
			tabs: [],
			activeId: null,
			closedUrls: [...urls, ...state.closedUrls].slice(0, MAX_CLOSED_TABS),
		}));
		for (const tab of all) {
			if (tab.id.startsWith("frame-")) continue;
			await browser.close(tab.id).catch(() => {});
		}
	},

	copyUrl: async (tabId) => {
		const tab = get().tabs.find((entry) => entry.id === tabId);
		if (!tab?.url) return;
		await navigator.clipboard.writeText(tab.url).catch(() => {});
		toast.success("URL copied", tab.url);
	},

	restoreSession: async () => {
		const session = useBrowserSessionStore.getState();
		if (session.restored) return;
		const state = get();
		// Already a live session, or a platform where tabs are not ours to
		// recreate (no native views and no gateway): consume the marker.
		if (state.tabs.length > 0 || (!state.supported && !state.gateway)) {
			session.markRestored();
			return;
		}
		// Consume before the first await: React strict-mode double mounts and
		// unmounts mid-restore can never replay the snapshot twice.
		session.markRestored();
		if (!session.snapshot) return;
		const { activeUrl, urls } = session.snapshot;
		for (const url of urls) {
			if (!normalizeUrl(url)) continue;
			await get().openTab(url).catch(() => {});
		}
		if (!activeUrl) return;
		const active = get().tabs.find((tab) => tab.url === activeUrl);
		if (active) void get().activate(active.id);
	},

	requestExternalConfirm: (url) => {
		// One live confirmation at a time; a burst of handoffs lands newest.
		if (get().externalPrompt?.url === url) return;
		set({ externalPrompt: { id: `ext-${Date.now().toString(36)}`, url } });
	},

	decideExternalPrompt: (accept) => {
		const prompt = get().externalPrompt;
		if (!prompt) return;
		set({ externalPrompt: null });
		if (!accept) {
			triggerHaptic("cancel");
			return;
		}
		// The user accepted an explicit handoff: system browser, setting aside.
		openExternalLink(prompt.url, { forceDefault: true });
		triggerHaptic("open");
	},

	find: async (query, backwards) => {
		const tabId = get().activeId;
		if (!tabId || tabId.startsWith("start-") || !query) return null;
		return browser.find(tabId, query, backwards).catch(() => null);
	},

	reorder: (tabId, beforeId) => {
		set((state) => ({ tabs: moveTabBefore(state.tabs, tabId, beforeId) }));
	},

	reopenClosed: async () => {
		const [url, ...rest] = get().closedUrls;
		if (!url) return;
		set({ closedUrls: rest });
		await get().openTab(url);
	},

	clearRecentDownloads: () => set({ recentDownloads: [] }),

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

	decideAgentAsk: async (id, allow, remember) => {
		await browser.agentDecide({ id, allow, remember }).catch(() => {});
		set((state) => ({ agentAsks: state.agentAsks.filter((ask) => ask.id !== id) }));
	},

	applyEvent: (event) => {
		const state = get();
		switch (event.type) {
			case "load":
				if (!isFresh(event, event.tabId)) return;
				set({
					tabs: state.tabs.map((tab) =>
						tab.id === event.tabId ? { ...tab, url: event.url, loading: event.started } : tab,
					),
				});
				// A finished load is a page the user actually saw: remember it for
				// the start surface (the title usually arrives just after this).
				if (!event.started) {
					const loaded = get().tabs.find((tab) => tab.id === event.tabId);
					useBrowserRecentStore.getState().record(event.url, loaded?.title ?? "");
				}
				break;
			case "title":
				// No seq gate: a title that arrives after the finished-load event
				// carries a lower ordinal but is the correct name for the tab.
				set({
					tabs: state.tabs.map((tab) => (tab.id === event.tabId ? { ...tab, title: event.title } : tab)),
				});
				// Keep the start surface's label truthful when the name lands after
				// the load settled (the common order).
				{
					const titled = get().tabs.find((tab) => tab.id === event.tabId);
					if (titled?.url) {
						useBrowserRecentStore.getState().record(titled.url, event.title);
					}
				}
				break;
			case "url":
				if (!isFresh(event, event.tabId)) return;
				set({
					tabs: state.tabs.map((tab) => (tab.id === event.tabId ? { ...tab, url: event.url } : tab)),
				});
				break;
			case "history":
				if (!isFresh(event, event.tabId)) return;
				set({
					tabs: state.tabs.map((tab) =>
						tab.id === event.tabId
							? { ...tab, back: event.back, forward: event.forward }
							: tab,
					),
				});
				break;
			case "external": {
				// http(s) handoffs (downloads, target=_blank the view won't
				// host) stay automatic: the system browser is the only reader.
				if (isWebUrl(event.url)) {
					// A page inside the panel is handing off its own link: the
					// panel already declined to host it, so it belongs in the
					// system browser regardless of the link-target setting.
					openExternalLink(event.url, { forceDefault: true });
					break;
				}
				// Non-web schemes can trigger mail clients, file handlers and
				// app-specific tools: the user confirms before any of that.
				get().requestExternalConfirm(event.url);
				break;
			}
			case "newTab":
				void state.openTab(event.url);
				break;
			case "proxyFailed":
				toast.error(
					"Page refused to load",
					"The browser proxy could not route this tab; the page was left blank on purpose (unproxied loads never happen).",
				);
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
				for (const kind of ["load", "title", "url", "history"]) {
					lastSeqByTab.delete(`${kind}:${event.tabId}`);
				}
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
				set({
					downloads: state.downloads.filter((prompt) => prompt.id !== event.id),
					recentDownloads:
						event.success && event.path
							? [{ path: event.path, at: Date.now() }, ...state.recentDownloads].slice(0, 10)
							: state.recentDownloads,
				});
				break;
			case "agentAsk":
				// Newest ask at the front; the oldest (rare burst) waits.
				set({ agentAsks: [
					{ id: event.id, tabId: event.tabId, host: event.host, url: event.url, op: event.op, sensitive: event.sensitive },
					...state.agentAsks.filter((ask) => ask.id !== event.id),
				].slice(0, 5) });
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

// Last applied event ordinal per tab AND kind; Rust hands out one counter per
// tab under its lock, so an older commit's event can never overwrite a newer
// one. Keying by kind matters: comparing a `load` against a `url`/`history`
// ordinal let a later-delivered finish get dropped by a redirect's commit
// event, which pinned the tab spinner on forever.
const lastSeqByTab = new Map<string, number>();

/** Drops events an older commit of the same kind superseded. */
function isFresh(event: BrowserEvent, tabId: string): boolean {
	if (!("seq" in event)) return true;
	if (event.seq === 0) return true;
	const key = `${event.type}:${tabId}`;
	const last = lastSeqByTab.get(key) ?? 0;
	if (event.seq <= last) return false;
	lastSeqByTab.set(key, event.seq);
	return true;
}
// A native page under the app webview needs the body transparent over the
// page's region (index.css `.has-page`): keep the class in sync with whether
// any OS page view is live.
useBrowserStore.subscribe((state) => {
	// Start tabs and reading frames paint in the app's own webview; only a
	// native page under the transparent chrome needs the grain switched off.
	const on = Boolean(
		state.supported &&
			state.layered &&
			state.tabs.some((tab) => tab.url && !tab.id.startsWith("frame-")),
	);
	document.documentElement.classList.toggle("has-page", on);
	syncSessionSnapshot(state);
});
// Bind the event channel once at module load; the store exists before React.
let bound = false;
if (!bound) {
	bound = true;
	void useBrowserStore
		.getState()
		.init()
		.then(() => onBrowserEvent((event) => useBrowserStore.getState().applyEvent(event)))
		.catch((error) => {
			rendererLog(`browser: store binding failed: ${String(error)}`);
			return onBrowserEvent((event) => useBrowserStore.getState().applyEvent(event));
		});
}
/** Hydrate the link-target preference from the CLI settings' browser object
 *  (browser.linkTarget). Called once at app boot; the settings widget syncs
 *  the store immediately on change so link clicks see the new value without
 *  waiting for the next boot. */
export async function hydrateLinkTarget(): Promise<void> {
	try {
		const global = await readSettingsFile({ scope: "global" }).then(
			(v) => (v ?? {}) as Record<string, unknown>,
			() => ({}) as Record<string, unknown>,
		);
		const browser = (global.browser ?? {}) as Record<string, unknown>;
		const value = (browser as { linkTarget?: unknown }).linkTarget;
		useBrowserStore.setState({ linkTarget: value === "desktop" ? "desktop" : "default" });
	} catch {
		// Unreadable settings keep the default (system browser).
	}
}
