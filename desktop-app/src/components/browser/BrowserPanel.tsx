// The agent browser panel: tab strip + address bar + the area where the native
// page views live, plus find, downloads, capture, and the start surface. On
// macOS 14+ pages sit under the whole panel (transparent chrome over a live
// page); elsewhere the page area is the only space pages occupy.
//
// A tab with no URL is a start tab: nothing is loaded, no native view exists,
// and the page area renders the app's own start surface. The first navigation
// creates the view through the panel's bounds pass, so no blank page ever
// covers it.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	ArrowLeft,
	ArrowRight,
	Camera,
	Copy,
	Download,
	ExternalLink,
	Globe,
	History,
	Link2,
	Loader2,
	Lock,
	Minus,
	MoreHorizontal,
	PanelRightClose,
	Plus,
	RotateCw,
	Search,
	Settings2,
	Volume2,
	VolumeX,
	X,
} from "lucide-react";
import browser, { boundsOf, type ViewBounds } from "../../lib/browser";
import * as rpc from "../../lib/rpc";
import { closeHole, updateHole } from "../../lib/browser-hole";
import { openExternalLink } from "../../lib/external-link";
import { cn } from "../../lib/cn";
import { ESCAPE_PRIORITY, isTopEscapeLayer, pushEscapeLayer } from "../../lib/escape-layers";
import { normalizeUrl, useBrowserStore } from "../../stores/browser-store";
import { toast } from "../../stores/toast-store";
import { IconButton } from "../ui/Button";
import { Tip } from "../ui/Tip";
import { TabFavicon } from "./TabFavicon";
import { TabContextMenu } from "./TabContextMenu";
import { ExternalHandoffDialog } from "./ExternalHandoffDialog";
import { AgentAskDialog } from "./AgentAskDialog";
import { AgentPermissionPill, type AgentPermissionMode } from "./AgentPermissionPill";
import { BrowserFindBar } from "./BrowserFindBar";
import { BrowserDownloadsPopover } from "./BrowserDownloadsPopover";
import { BrowserPopover, MenuRow, MenuSeparator } from "./BrowserPopover";
import { BrowserStartPage } from "./BrowserStartPage";

const TOOLBAR_TRIGGER =
	"relative flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-pi-text-secondary transition-hover hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none disabled:cursor-default disabled:opacity-40";

const ZOOM_STEPS = [0.75, 0.9, 1, 1.25, 1.5, 2];

function clampZoom(value: number): number {
	return Math.min(5, Math.max(0.25, Math.round(value * 100) / 100));
}

export function BrowserPanel({ onClose }: { onClose: () => void }) {
	const supported = useBrowserStore((state) => state.supported);
	const gateway = useBrowserStore((state) => state.gateway);
	const layered = useBrowserStore((state) => state.layered);
	const captureSupported = useBrowserStore((state) => state.captureSupported);
	const tabs = useBrowserStore((state) => state.tabs);
	const activeId = useBrowserStore((state) => state.activeId);
	const downloads = useBrowserStore((state) => state.downloads);
	const closedCount = useBrowserStore((state) => state.closedUrls.length);
	const pendingUrl = useBrowserStore((state) => state.pendingUrl);
	const openTab = useBrowserStore((state) => state.openTab);
	const activate = useBrowserStore((state) => state.activate);
	const closeTab = useBrowserStore((state) => state.close);
	const captureTab = useBrowserStore((state) => state.capture);

	const panelRef = useRef<HTMLDivElement | null>(null);
	const chromeRef = useRef<HTMLDivElement | null>(null);
	const pageAreaRef = useRef<HTMLDivElement | null>(null);
	const addressRef = useRef<HTMLInputElement | null>(null);
	const addressFocused = useRef(false);
	const [address, setAddress] = useState("");
	const [findOpen, setFindOpen] = useState(false);
	const [zoomOpen, setZoomOpen] = useState(false);
	const [downloadsOpen, setDownloadsOpen] = useState(false);
	const [overflowOpen, setOverflowOpen] = useState(false);
	const [capturing, setCapturing] = useState(false);
	const [contextTab, setContextTab] = useState<{ id: string; left: number; top: number } | null>(null);
	const [dragId, setDragId] = useState<string | null>(null);
	// Agent tool permissions: Ask vs Auto — the gate reads this pref per op.
	const [permissionMode, setPermissionMode] = useState<AgentPermissionMode>("ask");

	useEffect(() => {
		void rpc.getBrowserPermissionMode()
			.then((mode) => setPermissionMode(mode === "auto" ? "auto" : "ask"))
			.catch(() => {});
	}, []);

	const active = tabs.find((tab) => tab.id === activeId) ?? null;
	const activeUrl = active?.url ?? "";
	const startVisible = activeUrl.length === 0;
	const captureUrl = active?.captureUrl;
	const zoom = active?.zoom ?? 1;
	const zoomPct = Math.round(zoom * 100);
	const menusOpen = zoomOpen || downloadsOpen || overflowOpen;
	const blocked = captureUrl != null || menusOpen;

	// Find only applies to a live page; a start tab hides it (and must not
	// keep the Escape layer registered behind nothing).
	useEffect(() => {
		if (!activeUrl) setFindOpen(false);
	}, [activeUrl]);

	// Restore the address box when switching tabs or when the page navigates,
	// unless the user is editing it right now.
	useEffect(() => {
		if (addressFocused.current) return;
		setAddress(active?.url ?? "");
	}, [activeId, active?.url]);

	// Keep the right page in the page area (below the chrome) on every
	// platform: a page that filled the whole panel would start its own
	// content behind the opaque chrome band, cropping the site's menus.
	const currentBounds = useCallback((): ViewBounds | null => {
		const area = pageAreaRef.current;
		if (!area || !document.body) return null;
		const viewportWidth = window.innerWidth;
		if (!viewportWidth || viewportWidth <= 0) return null;
		return boundsOf(area.getBoundingClientRect(), viewportWidth);
	}, []);

	useEffect(() => {
		if (!supported || !activeId) return;
		// Mounted with a live tab ⇒ the panel is open (other effects read it).
		useBrowserStore.setState({ open: true });
		const tab = useBrowserStore.getState().tabs.find((entry) => entry.id === activeId);
		if (!tab?.url) {
			// Start surface: no page to show, and no hole for one.
			closeHole();
			void browser.viewShow({}).catch(() => {});
			return;
		}
		const bounds = currentBounds();
		if (!bounds) return;
		// Layered pages composite under the app webview: cut the hole at the
		// page area's rect at the same time the native view is moved.
		updateHole(layered ? (pageAreaRef.current ?? null) : null);
		// Passing the URL lets the first show create the view (start tabs have
		// none yet); an existing view ignores it.
		void browser
			.viewShow({ tabId: activeId, url: tab.url, bounds })
			.catch(() => {});
		const observer = new ResizeObserver(() => {
			const next = currentBounds();
			if (next) void browser.viewShow({ tabId: activeId, url: tab.url, bounds: next }).catch(() => {});
			updateHole(layered ? (pageAreaRef.current ?? null) : null);
		});
		// Rail drags and find-bar toggles reshape the panel/area inside an
		// unchanged window, so the boxes themselves are what needs watching
		// (body only resizes with the window).
		const panel = panelRef.current;
		const area = pageAreaRef.current;
		if (panel) observer.observe(panel);
		if (area) observer.observe(area);
		return () => {
			observer.disconnect();
			closeHole();
		};
	}, [supported, activeId, activeUrl, layered, currentBounds]);

	// No layer, no page under the app: drop any hole the previous layout left.
	useEffect(() => {
		if (!layered && supported) closeHole();
	}, [supported, layered]);

	// Panel mounted: pages may show; unmounted: park every page until it
	// remounts (rail switches unmount this panel).
	useEffect(() => {
		return () => {
			closeHole();
			void browser.viewShow({}).catch(() => {});
			useBrowserStore.setState({ open: false });
		};
	}, []);

	// Layered mode: tell the Rust layer which chrome rects take clicks, and
	// that an open menu or the capture preview blocks the page entirely.
	useEffect(() => {
		if (!layered || !supported || !activeId) return;
		const report = () => {
			const root = panelRef.current;
			const viewportWidth = window.innerWidth;
			if (!root || !viewportWidth) return;
			const rects: ViewBounds[] = [];
			// Viewport-relative: the router subtracts these from main-view points
			// (point = WebKit CSS px); panel-relative is one rail drag off. Every
			// marked surface in the panel counts — toolbar, tab strip, popovers,
			// find bar, download cards — so clicks on them never reach the page.
			for (const child of root.querySelectorAll<HTMLElement>("[data-browser-input]")) {
				const rect = child.getBoundingClientRect();
				if (rect.width > 0 && rect.height > 0) {
					rects.push({
						x: rect.left,
						y: rect.top,
						width: rect.width,
						height: rect.height,
						viewportWidth,
					});
				}
			}
			void browser.setPageInput(blocked, rects).catch(() => {});
		};
		report();
		const observer = new ResizeObserver(report);
		if (chromeRef.current) observer.observe(chromeRef.current);
		if (pageAreaRef.current) observer.observe(pageAreaRef.current);
		return () => {
			observer.disconnect();
		};
	}, [layered, supported, activeId, blocked, downloads.length, captureUrl]);

	const navigateTo = (url: string) => {
		// No native views and no reading frame: the system browser is the only
		// reader, so keep the start surface and hand the address off.
		if (!supported && !gateway) {
			void openExternalLink(url, { forceDefault: true });
			return;
		}
		if (active) {
			void useBrowserStore.getState().navigate(active.id, url);
			return;
		}
		void openTab(url);
	};

	const handleNavigateInput = (event: React.FormEvent) => {
		event.preventDefault();
		const url = normalizeUrl(address);
		if (!url) return;
		navigateTo(url);
	};

	const handleNewTab = () => {
		void openTab();
	};

	const applyZoom = (next: number) => {
		if (!active) return;
		void useBrowserStore.getState().setZoom(active.id, clampZoom(next));
	};

	const openInSystemBrowser = () => {
		if (active?.url) openExternalLink(active.url, { forceDefault: true });
	};

	const openBrowserSettings = () => {
		// SettingsPanel reads the nav id from the hash at mount; set it before
		// dispatching so the panel lands on Browser, not General.
		window.location.hash = "browser";
		window.dispatchEvent(new CustomEvent("a-coder:open-settings"));
	};

	// Panel shortcuts while the chrome has focus (the page keeps its keys
	// while the page has focus, like any browser).
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.defaultPrevented) return;
			if (event.ctrlKey && !event.metaKey && event.key === "Tab") {
				event.preventDefault();
				if (tabs.length < 2) return;
				const index = tabs.findIndex((tab) => tab.id === activeId);
				const step = event.shiftKey ? -1 : 1;
				const next = tabs[(index + step + tabs.length) % tabs.length];
				if (next) void activate(next.id);
				return;
			}
			if (!(event.metaKey || event.ctrlKey) || event.shiftKey) return;
			const key = event.key.toLowerCase();
			if (key === "l") {
				event.preventDefault();
				addressRef.current?.focus();
				addressRef.current?.select();
			} else if (key === "t") {
				event.preventDefault();
				handleNewTab();
			} else if (key === "w") {
				event.preventDefault();
				if (activeId) void useBrowserStore.getState().close(activeId);
			} else if (key === "f") {
				event.preventDefault();
				if (activeUrl) setFindOpen(true);
			} else if (key === "r") {
				event.preventDefault();
				if (activeId) void useBrowserStore.getState().action(activeId, "reload");
			} else if (/^[1-9]$/.test(key)) {
				const tab = tabs[Number(key) - 1];
				if (tab) {
					event.preventDefault();
					void activate(tab.id);
				}
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [activeId, activeUrl, tabs, activate]);

	// Capture preview closes on Escape, under Find and palettes.
	useEffect(() => {
		if (!captureUrl) return;
		const unregister = pushEscapeLayer(ESCAPE_PRIORITY.capture);
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			if (!isTopEscapeLayer(ESCAPE_PRIORITY.capture)) return;
			event.preventDefault();
			if (activeId) useBrowserStore.getState().dismissCapture(activeId);
		};
		document.addEventListener("keydown", onKey);
		return () => {
			unregister();
			document.removeEventListener("keydown", onKey);
		};
	}, [captureUrl, activeId]);

	// An agent tool asked for a tab while the panel was closed: open it now
	// that the bounds are measured, then clear the request.
	useEffect(() => {
		if (!pendingUrl || !supported) return;
		const url = pendingUrl;
		useBrowserStore.setState({ pendingUrl: null });
		void openTab(url);
	}, [pendingUrl, supported, openTab]);

	const handleCapture = async () => {
		if (!active) return;
		setCapturing(true);
		try {
			await captureTab(active.id);
		} finally {
			setCapturing(false);
		}
	};

	const copyCaptureImage = async () => {
		if (!captureUrl) return;
		try {
			const blob = await fetch(captureUrl).then((response) => response.blob());
			await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
			toast.success("Screenshot copied");
		} catch {
			toast.error("Could not copy the screenshot");
		}
	};

	// One-shot restore of the previous run's open tabs (consumes its marker);
	// a fresh panel then opens a start tab, so the strip is never an empty row.
	useEffect(() => {
		void (async () => {
			await useBrowserStore.getState().restoreSession();
			if (useBrowserStore.getState().tabs.length === 0) {
				await useBrowserStore.getState().openTab();
			}
		})();
	}, []);

	const siteGlyph = useMemo(() => {
		if (active?.loading) {
			return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-pi-text-muted" />;
		}
		if (!activeUrl) return <Search className="h-3.5 w-3.5 shrink-0 text-pi-text-muted" />;
		if (activeUrl.startsWith("https:")) {
			return <Lock className="h-3 w-3 shrink-0 text-pi-text-faint" />;
		}
		return <Globe className="h-3.5 w-3.5 shrink-0 text-pi-text-muted" />;
	}, [active?.loading, activeUrl]);

	return (
		<div ref={panelRef} className="relative flex h-full min-h-0 w-full flex-col bg-pi-bg">
			{/* Chrome over the page (layered) or above it (plain) */}
			<div ref={chromeRef} className="flex shrink-0 flex-col border-b border-pi-border bg-pi-bg">
				{/* Tab strip */}
				<div data-browser-input className="flex items-center gap-0.5 px-2 pt-1.5">
					<div role="tablist" aria-label="Browser tabs" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
					{tabs.map((tab) => {
						const selected = tab.id === activeId;
						return (
							<button
								key={tab.id}
								role="tab"
								aria-selected={selected}
								data-browser-input
								draggable
								onClick={() => void activate(tab.id)}
								onAuxClick={(event) => {
									if (event.button === 1) {
										event.preventDefault();
										void closeTab(tab.id);
									}
								}}
								onContextMenu={(event) => {
									event.preventDefault();
									setContextTab({ id: tab.id, left: event.clientX, top: event.clientY });
								}}
								onDragStart={() => setDragId(tab.id)}
								onDragEnd={() => setDragId(null)}
								onDragOver={(event) => event.preventDefault()}
								onDrop={(event) => {
									event.preventDefault();
									if (dragId && dragId !== tab.id) {
										useBrowserStore.getState().reorder(dragId, tab.id);
									}
									setDragId(null);
								}}
								className={cn(
									"group relative flex h-7 min-w-[88px] max-w-52 flex-1 shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md px-2.5 text-xs transition-hover focus-visible:shadow-focus focus-visible:outline-none",
									selected
										? "bg-pi-surface-raised text-pi-text"
										: "text-pi-text-secondary hover:bg-pi-surface-raised/60 hover:text-pi-text",
									dragId === tab.id && "opacity-50",
								)}
								aria-label={`Tab: ${tab.title || tab.url || "New tab"}`}
							>
								{selected && (
									<span className="absolute inset-x-1.5 -top-px h-0.5 rounded-full bg-pi-accent" />
								)}
								{tab.loading ? (
									<Loader2 className="h-3 w-3 shrink-0 animate-spin text-pi-text-muted" />
								) : (
									<TabFavicon url={tab.url} />
								)}
								<span className="min-w-0 flex-1 truncate text-left">
									{tab.title || tab.url || "New tab"}
								</span>
								{tab.muted && <VolumeX className="h-3 w-3 shrink-0 text-pi-text-muted" />}
								<span
									role="button"
									tabIndex={0}
									onClick={(event) => {
										event.stopPropagation();
										void closeTab(tab.id);
									}}
									onKeyDown={(event) => {
										if (event.key === "Enter" || event.key === " ") {
											event.stopPropagation();
											event.preventDefault();
											void closeTab(tab.id);
										}
									}}
									className={cn(
										"shrink-0 rounded p-0.5 hover:bg-pi-border focus-visible:shadow-focus focus-visible:outline-none",
										selected ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus:opacity-100",
									)}
									aria-label={`Close tab ${tab.title || tab.url || "New tab"}`}
								>
									<X className="h-3 w-3" />
								</span>
							</button>
						);
					})}
					</div>
					<Tip content="New tab" placement="toolbar">
						<button
							data-browser-input
							onClick={handleNewTab}
							className={cn(TOOLBAR_TRIGGER, "h-6 w-6 shrink-0")}
							aria-label="New tab"
						>
							<Plus className="h-3.5 w-3.5" />
						</button>
					</Tip>
					<div className="ml-auto flex shrink-0 items-center gap-1">
						{supported && (
							<AgentPermissionPill
								mode={permissionMode}
								onChange={(next) => {
									setPermissionMode(next);
									void rpc.setBrowserPermissionMode(next).catch(() => setPermissionMode("ask"));
								}}
							/>
						)}
						<Tip content="Close browser panel" placement="toolbar">
							<button
								data-browser-input
								onClick={onClose}
								className={cn(TOOLBAR_TRIGGER, "h-6 w-6")}
								aria-label="Close browser panel"
							>
								<X className="h-3.5 w-3.5" />
							</button>
						</Tip>
					</div>
				</div>

				{/* Toolbar: navigation, address, page actions */}
				<div data-browser-input className="flex items-center gap-1 px-2 pb-1.5 pt-1">
					<Tip content="Back" placement="toolbar">
						<IconButton
							size="sm"
							icon={ArrowLeft}
							aria-label="Back"
							disabled={!active || !active.back}
							onClick={() => active && void useBrowserStore.getState().action(active.id, "back")}
						/>
					</Tip>
					<Tip content="Forward" placement="toolbar">
						<IconButton
							size="sm"
							icon={ArrowRight}
							aria-label="Forward"
							disabled={!active || !active.forward}
							onClick={() => active && void useBrowserStore.getState().action(active.id, "forward")}
						/>
					</Tip>
					<Tip content={active?.loading ? "Stop" : "Reload"} placement="toolbar">
						<IconButton
							size="sm"
							icon={active?.loading ? X : RotateCw}
							aria-label={active?.loading ? "Stop" : "Reload"}
							disabled={!active}
							onClick={() =>
								active &&
								void useBrowserStore
									.getState()
									.action(active.id, active.loading ? "stop" : "reload")
							}
						/>
					</Tip>

					<form
						onSubmit={handleNavigateInput}
						className="ml-1 flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-pi-border bg-pi-surface-raised pl-2 pr-1 transition-smooth focus-within:border-pi-accent/60 focus-within:shadow-focus-inner"
					>
						{siteGlyph}
						<input
							data-browser-input
							ref={addressRef}
							value={address}
							onChange={(event) => setAddress(event.target.value)}
							onFocus={(event) => {
								addressFocused.current = true;
								event.currentTarget.select();
							}}
							onBlur={() => {
								addressFocused.current = false;
								setAddress(active?.url ?? "");
							}}
							onKeyDown={(event) => {
								if (event.key === "Escape") {
									event.currentTarget.value = active?.url ?? "";
									setAddress(active?.url ?? "");
									event.currentTarget.blur();
								}
							}}
							placeholder="Search or enter address"
							aria-label="Address and search"
							className="h-7 w-full min-w-0 bg-transparent text-xs text-pi-text placeholder:text-pi-text-muted focus:outline-none"
							spellCheck={false}
							autoComplete="off"
						/>
						{activeUrl && (
							<Tip content="Open in your browser" placement="toolbar">
								<button
									data-browser-input
									type="button"
									onClick={openInSystemBrowser}
									aria-label="Open in your browser"
									className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded text-pi-text-faint transition-hover hover:bg-pi-surface-overlay hover:text-pi-text"
								>
									<ExternalLink className="h-3 w-3" />
								</button>
							</Tip>
						)}
					</form>

					{/* Zoom */}
					<div className="relative shrink-0">
						<Tip content="Zoom" placement="toolbar">
							<button
								data-browser-input
								onClick={() => setZoomOpen((value) => !value)}
								aria-label={`Zoom ${zoomPct}%`}
								aria-haspopup="menu"
								aria-expanded={zoomOpen}
								className={cn(TOOLBAR_TRIGGER, "w-9 text-3xs tabular-nums text-pi-text-secondary")}
							>
								{zoomPct}%
							</button>
						</Tip>
						<BrowserPopover open={zoomOpen} onClose={() => setZoomOpen(false)} label="Zoom" className="w-48">
							<div className="flex items-center justify-between px-1 py-1">
								<IconButton
									size="sm"
									icon={Minus}
									aria-label="Zoom out"
									disabled={!active}
									onClick={() => applyZoom(zoom - 0.1)}
								/>
								<span className="text-xs tabular-nums text-pi-text">{zoomPct}%</span>
								<IconButton
									size="sm"
									icon={Plus}
									aria-label="Zoom in"
									disabled={!active}
									onClick={() => applyZoom(zoom + 0.1)}
								/>
							</div>
							<div className="mt-1 grid grid-cols-3 gap-1 border-t border-pi-border pt-1.5">
								{ZOOM_STEPS.map((step) => (
									<button
										key={step}
										type="button"
										onClick={() => applyZoom(step)}
										disabled={!active}
										className={cn(
											"cursor-pointer rounded px-1 py-1 text-3xs tabular-nums transition-hover disabled:cursor-default disabled:opacity-40",
											Math.abs(zoom - step) < 0.001
												? "bg-pi-accent-soft text-pi-accent"
												: "text-pi-text-secondary hover:bg-pi-surface-raised hover:text-pi-text",
										)}
									>
										{Math.round(step * 100)}%
									</button>
								))}
							</div>
						</BrowserPopover>
					</div>

					{/* Downloads */}
					<div className="relative shrink-0">
						<Tip content="Downloads" placement="toolbar">
							<button
								data-browser-input
								onClick={() => setDownloadsOpen((value) => !value)}
								aria-label={
									downloads.length > 0
										? `Downloads, ${downloads.length} waiting`
										: "Downloads"
								}
								aria-haspopup="menu"
								aria-expanded={downloadsOpen}
								className={TOOLBAR_TRIGGER}
							>
								<Download className="h-3.5 w-3.5" />
								{downloads.length > 0 && (
									<span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-pi-accent px-1 text-[9px] font-semibold leading-none text-white">
										{downloads.length}
									</span>
								)}
							</button>
						</Tip>
						<BrowserDownloadsPopover
							open={downloadsOpen}
							onClose={() => setDownloadsOpen(false)}
							onOpenSettings={() => {
								setDownloadsOpen(false);
								openBrowserSettings();
							}}
						/>
					</div>

					<Tip
						content={
							captureSupported
								? "Capture the page"
								: "Screenshots are not available on this platform"
						}
						placement="toolbar"
					>
						<button
							data-browser-input
							onClick={() => void handleCapture()}
							disabled={!activeUrl || capturing || !captureSupported}
							aria-label="Capture page screenshot"
							className={TOOLBAR_TRIGGER}
						>
							{capturing ? (
								<Loader2 className="h-3.5 w-3.5 animate-spin" />
							) : (
								<Camera className="h-3.5 w-3.5" />
							)}
						</button>
					</Tip>

					{/* Overflow */}
					<div className="relative shrink-0">
						<Tip content="More" placement="toolbar">
							<button
								data-browser-input
								onClick={() => setOverflowOpen((value) => !value)}
								aria-label="More actions"
								aria-haspopup="menu"
								aria-expanded={overflowOpen}
								className={TOOLBAR_TRIGGER}
							>
								<MoreHorizontal className="h-3.5 w-3.5" />
							</button>
						</Tip>
						<BrowserPopover open={overflowOpen} onClose={() => setOverflowOpen(false)} label="More actions" className="w-52">
							<MenuRow
								icon={Search}
								label="Find in page"
								hint="⌘F"
								disabled={!activeUrl}
								onClick={() => {
									setOverflowOpen(false);
									setFindOpen(true);
								}}
							/>
							<MenuRow
								icon={active?.muted ? Volume2 : VolumeX}
								label={active?.muted ? "Unmute tab" : "Mute tab"}
								disabled={!active}
								onClick={() => {
									if (!active) return;
									setOverflowOpen(false);
									void useBrowserStore.getState().setMuted(active.id, !active.muted);
								}}
							/>
							<MenuRow
								icon={ExternalLink}
								label="Open in your browser"
								disabled={!activeUrl}
								onClick={() => {
									setOverflowOpen(false);
									openInSystemBrowser();
								}}
							/>
							<MenuRow
								icon={History}
								label="Reopen closed tab"
								disabled={closedCount === 0}
								onClick={() => {
									setOverflowOpen(false);
									void useBrowserStore.getState().reopenClosed();
								}}
							/>
							<MenuSeparator />
							<MenuRow
								icon={Settings2}
								label="Browser settings"
								onClick={() => {
									setOverflowOpen(false);
									openBrowserSettings();
								}}
							/>
							<MenuRow
								icon={PanelRightClose}
								label="Close panel"
								onClick={() => {
									setOverflowOpen(false);
									onClose();
								}}
							/>
						</BrowserPopover>
					</div>
				</div>
				{/* Loading hairline: the chrome stays calm, the page says it is busy. */}
				{active?.loading && activeUrl ? (
					<div className="h-px w-full overflow-hidden bg-pi-border">
						<div className="h-full w-1/3 animate-pulse rounded-full bg-pi-accent/70" />
					</div>
				) : null}
			</div>

			{/* Page area: native webviews are placed here by Rust; the start
			    surface and in-page overlays paint above it. */}
			<div ref={pageAreaRef} className="relative min-h-0 flex-1 bg-pi-bg">
				{startVisible && (
					<BrowserStartPage
						onNavigate={navigateTo}
						onOpenSettings={openBrowserSettings}
						agentMode={supported ? permissionMode : null}
						externalOnly={!supported && !gateway}
					/>
				)}

				{!supported && gateway && !startVisible && (
					<div className="relative h-full bg-white">
						{active?.url && (
							<iframe
								title={active.title || active.url}
								sandbox="allow-scripts"
								className="h-full w-full border-0"
								src={`${gateway}/page?u=${encodeURIComponent(active.url)}`}
								referrerPolicy="no-referrer"
							/>
						)}
						<div className="pointer-events-none absolute left-2 top-2 rounded bg-pi-bg/80 px-2 py-0.5 text-[10px] text-pi-text-muted">
							Reading frame — scripts, cookies and storage are disabled; forms are preview-only
						</div>
					</div>
				)}

				<BrowserFindBar open={findOpen} tabId={activeUrl ? activeId : null} onClose={() => setFindOpen(false)} />

				{/* Capture preview: the screenshot an agent (or user) sees. */}
				{captureUrl && active && (
					<div
						data-browser-input
						className="absolute inset-0 z-10 flex flex-col bg-pi-bg/95 backdrop-blur-sm"
					>
						<div className="flex shrink-0 items-center justify-between gap-3 border-b border-pi-border px-3 py-2">
							<div className="min-w-0">
								<div className="truncate text-xs font-medium text-pi-text">Capture</div>
								<div className="truncate text-3xs text-pi-text-muted">{active.url}</div>
							</div>
							<div className="flex shrink-0 items-center gap-1">
								<Tip content="Copy image" placement="toolbar">
									<IconButton
										size="sm"
										icon={Copy}
										aria-label="Copy screenshot"
										onClick={() => void copyCaptureImage()}
									/>
								</Tip>
								<Tip content="Copy page URL" placement="toolbar">
									<IconButton
										size="sm"
										icon={Link2}
										aria-label="Copy page URL"
										onClick={() => {
											void navigator.clipboard.writeText(active.url).catch(() => {});
											toast.success("URL copied", active.url);
											useBrowserStore.getState().dismissCapture(active.id);
										}}
									/>
								</Tip>
								<Tip content="Back to page" placement="toolbar">
									<IconButton
										size="sm"
										icon={X}
										aria-label="Close capture"
										onClick={() => useBrowserStore.getState().dismissCapture(active.id)}
									/>
								</Tip>
							</div>
						</div>
						<div className="flex min-h-0 flex-1 items-start justify-center overflow-auto p-4">
							<img
								src={captureUrl}
								alt="Captured page"
								className="max-w-full rounded-lg border border-pi-border shadow-overlay"
							/>
						</div>
					</div>
				)}
			</div>

			{/* Pending downloads, also reachable from the toolbar popover: a
			    page asking to save a file should never be missable. */}
			{downloads.length > 0 && (
				<div className="pointer-events-auto absolute bottom-3 right-3 z-10 flex w-72 flex-col gap-2">
					{downloads.slice(0, 3).map((prompt) => (
						<div
							key={prompt.id}
							data-browser-input
							className="rounded-lg border border-pi-border bg-pi-surface-overlay p-3 text-xs shadow-overlay"
						>
							<div className="flex items-center gap-2">
								<Download className="h-3.5 w-3.5 shrink-0 text-pi-text-muted" />
								<div className="min-w-0 flex-1">
									<div className="truncate font-medium text-pi-text">{prompt.name}</div>
									<div className="truncate text-3xs text-pi-text-muted">
										{prompt.site || prompt.url}
									</div>
								</div>
							</div>
							<div className="mt-2 flex justify-end gap-1.5">
								<button
									onClick={() => void useBrowserStore.getState().decideDownload(prompt.id, "cancel")}
									className="cursor-pointer rounded border border-pi-border px-2 py-0.5 text-3xs text-pi-text-secondary transition-hover hover:bg-pi-surface-raised hover:text-pi-text"
								>
									Cancel
								</button>
								<button
									onClick={() => void useBrowserStore.getState().decideDownload(prompt.id, "save")}
									className="cursor-pointer rounded bg-pi-accent px-2 py-0.5 text-3xs font-medium text-white transition-hover hover:bg-pi-accent-hover"
								>
									Save
								</button>
							</div>
						</div>
					))}
				</div>
			)}

			<TabContextMenu
				tabId={contextTab?.id ?? ""}
				left={contextTab?.left ?? 0}
				top={contextTab?.top ?? 0}
				onClose={() => setContextTab(null)}
			/>
			<ExternalHandoffDialog />
			<AgentAskDialog />
		</div>
	);
}
