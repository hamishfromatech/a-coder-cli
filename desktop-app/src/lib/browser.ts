// A-Coder desktop browser panel bindings: invoke wrappers for the Tauri
// browser commands and the listener for the single event channel the Rust
// side emits (desktop://browser).

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface ViewBounds {
	x: number;
	y: number;
	width: number;
	height: number;
	/** The calling webview's CSS-pixel width, so Rust can account for app zoom. */
	viewportWidth: number;
}

export interface TabInfo {
	tabId: string;
	url: string | null;
	title: string;
}

export type BrowserEvent =
	| { type: "load"; tabId: string; url: string; started: boolean }
	| { type: "title"; tabId: string; title: string }
	| { type: "url"; tabId: string; url: string }
	| { type: "history"; tabId: string; back: boolean; forward: boolean }
	| { type: "external"; tabId: string; url: string }
	| { type: "newTab"; tabId: string; url: string }
	| { type: "openPanel"; url: string }
	| { type: "closed"; tabId: string }
	| {
			type: "downloadPrompt";
			id: string;
			tabId: string;
			url: string;
			site: string;
			name: string;
	  }
	| { type: "downloadSettled"; id: string; success: boolean; path?: string };

export interface AgentCommandResult {
	installed: boolean;
	result?: unknown;
}

const browser = {
	supported: () => invoke<boolean>("browser_supported"),
	layered: () => invoke<boolean>("browser_layered"),
	tabList: () => invoke<TabInfo[]>("browser_tab_list"),
	openTab: (args: { url?: string | null; bounds?: ViewBounds | null }) =>
		invoke<string>("browser_open_tab", { url: args.url ?? null, bounds: args.bounds ?? null }),
	viewShow: (args: {
		tabId?: string | null;
		url?: string | null;
		bounds?: ViewBounds | null;
		parked?: boolean;
	}) =>
		invoke<void>("browser_view_show", {
			tabId: args.tabId ?? null,
			url: args.url ?? null,
			bounds: args.bounds ?? null,
			parked: args.parked ?? false,
		}),
	navigate: (tabId: string, url: string) => invoke<void>("browser_navigate_tab", { tabId, url }),
	action: (tabId: string, action: string) => invoke<void>("browser_tab_action", { tabId, action }),
	setZoom: (tabId: string, zoom: number) => invoke<void>("browser_set_tab_zoom", { tabId, zoom }),
	close: (tabId: string) => invoke<void>("browser_close_tab", { tabId }),
	find: (tabId: string, query: string, backwards: boolean) =>
		invoke<boolean>("browser_find_in_page", { tabId, query, backwards }),
	setPageInput: (blocked: boolean, exclude: ViewBounds[]) =>
		invoke<void>("browser_set_page_input", { blocked, exclude }),
	setMuted: (tabId: string, muted: boolean) => invoke<void>("browser_tab_mute", { tabId, muted }),
	agent: (tabId: string, op: Record<string, unknown>, install = false) =>
		invoke<AgentCommandResult>("browser_agent", {
			tabId,
			command: install ? { op, install: true } : { op, install: false },
		}),
	captureSupported: () => invoke<boolean>("browser_capture_supported"),
	gatewayUrl: () => invoke<string | null>("browser_gateway_url"),
	capture: (tabId: string) =>
		invoke<ArrayBuffer | number[]>("browser_capture", { tabId, bounds: null }),
	captureRegion: (bounds: ViewBounds) =>
		invoke<ArrayBuffer | number[]>("browser_capture", { tabId: null, bounds }),
	downloadDecide: (id: string, action: "save" | "open" | "reveal" | "cancel") =>
		invoke<string | null>("browser_download_decide", { id, action }),
	downloadFolder: () => invoke<string | null>("browser_download_folder"),
	setDownloadFolder: (folder: string) =>
		invoke<void>("browser_download_folder_pick", { folder }),
	downloadOpen: (path: string) => invoke<void>("browser_download_open", { path }),
	downloadReveal: (path: string) => invoke<void>("browser_download_reveal", { path }),
};

export default browser;

export async function onBrowserEvent(handler: (event: BrowserEvent) => void): Promise<UnlistenFn> {
	return await listen<BrowserEvent>("desktop://browser", (event) => handler(event.payload));
}

/** The calling rect as ViewBounds the panel reports. */
export function boundsOf(rect: DOMRect, viewportWidth: number): ViewBounds {
	return {
		x: rect.left,
		y: rect.top,
		width: rect.width,
		height: rect.height,
		viewportWidth,
	};
}