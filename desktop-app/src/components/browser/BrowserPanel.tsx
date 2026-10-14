// The agent browser panel: tab bar + address bar + the area where the native
// page views live, plus capture, find, and download approvals. On macOS 14+
// pages sit under the whole panel (transparent chrome over a live page);
// elsewhere the page area is the only space pages occupy.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	ArrowLeft,
	ArrowRight,
	Search,
	Camera,
	ChevronDown,
	ChevronUp,
	RotateCw,
	Volume2,
	VolumeX,
	X,
	Plus,
	Loader2,
	Globe,
} from "lucide-react";
import browser, { boundsOf, type ViewBounds } from "../../lib/browser";
import { closeHole, updateHole } from "../../lib/browser-hole";
import { openExternalLink } from "../../lib/external-link";
import { normalizeUrl, useBrowserStore } from "../../stores/browser-store";

export function BrowserPanel({ onClose }: { onClose: () => void }) {
	const supported = useBrowserStore((state) => state.supported);
	const gateway = useBrowserStore((state) => state.gateway);
	const layered = useBrowserStore((state) => state.layered);
	const tabs = useBrowserStore((state) => state.tabs);
	const activeId = useBrowserStore((state) => state.activeId);
	const downloads = useBrowserStore((state) => state.downloads);
	const pendingUrl = useBrowserStore((state) => state.pendingUrl);
	const openTab = useBrowserStore((state) => state.openTab);
	const activate = useBrowserStore((state) => state.activate);
	const closeTab = useBrowserStore((state) => state.close);
	const captureTab = useBrowserStore((state) => state.capture);
	const decideDownload = useBrowserStore((state) => state.decideDownload);

	const panelRef = useRef<HTMLDivElement | null>(null);
	const chromeRef = useRef<HTMLDivElement | null>(null);
	const pageAreaRef = useRef<HTMLDivElement | null>(null);
	const addressRef = useRef<HTMLInputElement | null>(null);
	const [address, setAddress] = useState("");
	const [findOpen, setFindOpen] = useState(false);
	const [findQuery, setFindQuery] = useState("");
	const [zoomValue, setZoomValue] = useState(1);
	const [capturing, setCapturing] = useState(false);

	const active = tabs.find((tab) => tab.id === activeId) ?? null;
	const captureUrl = active?.captureUrl;

	// Restore the address box and zoom display when switching tabs.
	useEffect(() => {
		setAddress(active?.url ?? "");
		setZoomValue(active?.zoom ?? 1);
	}, [activeId, active?.url, active?.zoom]);

	// Fresh panel (no tabs): cursor in the address box right away.
	useEffect(() => {
		if (!supported || tabs.length > 0) return;
		requestAnimationFrame(() => addressRef.current?.focus());
	}, [supported, tabs.length]);

	// Keep the right page where it belongs: the whole panel on macOS 14+
	// (chrome draws over the page), the page area only elsewhere.
	const currentBounds = useCallback((): ViewBounds | null => {
		const panel = panelRef.current;
		const area = pageAreaRef.current;
		const element = layered ? panel : area;
		if (!element || !document.body) return null;
		const viewportWidth = window.innerWidth;
		if (!viewportWidth || viewportWidth <= 0) return null;
		return boundsOf(element.getBoundingClientRect(), viewportWidth);
	}, [layered]);

	useEffect(() => {
		if (!supported || !activeId) return;
		// Mounted with a live tab ⇒ the panel is open (other effects read it).
		useBrowserStore.setState({ open: true });
		const bounds = currentBounds();
		if (!bounds) return;
		// Layered pages composite under the app webview: cut the hole at the
		// page's rect at the same time the native view is moved.
		updateHole(layered ? (panelRef.current ?? null) : null);
		void browser
			.viewShow({ tabId: activeId, bounds })
			.catch(() => {});
		const observer = new ResizeObserver(() => {
			const next = currentBounds();
			if (next) void browser.viewShow({ tabId: activeId, bounds: next }).catch(() => {});
			updateHole(layered ? (panelRef.current ?? null) : null);
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
	}, [supported, activeId, layered, currentBounds]);

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
	// that a focused address field blocks the page entirely.
	useEffect(() => {
		if (!layered || !supported || !activeId) return;
		const report = (blocked: boolean) => {
			const chrome = chromeRef.current;
			const viewportWidth = window.innerWidth;
			if (!chrome || !viewportWidth) return;
			const rects: ViewBounds[] = [];
			// Viewport-relative: the router subtracts these from main-view points
			// (point = WebKit CSS px); panel-relative is one rail drag off.
			for (const child of chrome.querySelectorAll<HTMLElement>("[data-browser-input]")) {
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
		report(false);
		const observer = new ResizeObserver(() => report(false));
		if (chromeRef.current) observer.observe(chromeRef.current);
		if (downloads.length > 0) report(true);
		return () => {
			observer.disconnect();
		};
	}, [layered, supported, activeId, downloads.length]);

	const handleNavigateInput = (event: React.FormEvent) => {
		event.preventDefault();
		const url = normalizeUrl(address);
		if (!url) return;
		// No tab yet (fresh panel): the first address becomes the first tab.
		if (!active) {
			void openTab(url);
			return;
		}
		void useBrowserStore.getState().navigate(active.id, url);
	};

	const handleNewTab = () => {
		void openTab("https://www.google.com");
		// Fresh tab: put the cursor in the address box for the next address.
		requestAnimationFrame(() => addressRef.current?.focus());
	};

	// Panel shortcuts while the chrome has focus (the page keeps its keys
	// while the page has focus, like any browser).
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (!(event.metaKey || event.ctrlKey)) return;
			const key = event.key.toLowerCase();
			if (key === "l") {
				event.preventDefault();
				addressRef.current?.focus();
			} else if (key === "t") {
				event.preventDefault();
				handleNewTab();
			} else if (key === "w") {
				event.preventDefault();
				if (activeId) void useBrowserStore.getState().close(activeId);
			} else if (key === "f") {
				event.preventDefault();
				setFindOpen(true);
			} else if (key === "r") {
				event.preventDefault();
				if (activeId) void useBrowserStore.getState().action(activeId, "reload");
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [activeId, openTab]);

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

	const iconButton = useMemo(
		() =>
			"flex h-7 w-7 cursor-pointer items-center justify-center rounded border border-pi-border bg-pi-surface-raised text-pi-text-secondary transition-hover hover:bg-pi-surface-overlay hover:text-pi-text disabled:cursor-default disabled:opacity-40",
		[],
	);

	return (
		<div ref={panelRef} className="relative flex h-full min-h-0 w-full flex-col bg-transparent">
			{/* Chrome over the page (layered) or above it (plain) */}
			<div ref={chromeRef} className="flex shrink-0 flex-col border-b border-pi-border bg-pi-bg">
				{/* Tab bar */}
				<div data-browser-input className="flex items-center gap-1 overflow-x-auto px-2 pt-1.5">
					{tabs.map((tab) => (
						<button
							key={tab.id}
							data-browser-input
							onClick={() => void activate(tab.id)}
							className={`flex h-7 max-w-48 shrink-0 cursor-pointer items-center gap-1.5 rounded-t px-2.5 text-xs transition-hover ${
								tab.id === activeId
									? "bg-pi-surface-overlay text-pi-text"
									: "text-pi-text-secondary hover:bg-pi-surface-raised"
							}`}
							aria-label={`Tab: ${tab.title}`}
						>
							{tab.loading ? (
								<Loader2 className="h-3 w-3 shrink-0 animate-spin text-pi-text-muted" />
							) : (
								<Globe className="h-3 w-3 shrink-0 text-pi-text-muted" />
							)}
							<span className="min-w-0 flex-1 truncate text-left">{tab.title || tab.url}</span>
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
										void closeTab(tab.id);
									}
								}}
								className="shrink-0 rounded p-0.5 hover:bg-pi-border"
								aria-label={`Close tab ${tab.title}`}
							>
								<X className="h-3 w-3" />
							</span>
						</button>
					))}
					<button
						data-browser-input
						onClick={handleNewTab}
						className={iconButton}
						aria-label="New tab"
					>
						<Plus className="h-3.5 w-3.5" />
					</button>
					<button
						data-browser-input
						onClick={onClose}
						className={`${iconButton} ml-auto`}
						aria-label="Close browser panel"
					>
						<X className="h-3.5 w-3.5" />
					</button>
				</div>

				{/* Address bar */}
				<div data-browser-input className="flex items-center gap-1.5 px-2 py-1.5">
					<button
						data-browser-input
						className={iconButton}
						disabled={!active || !active.back}
						onClick={() => active && void useBrowserStore.getState().action(active.id, "back")}
						aria-label="Back"
					>
						<ArrowLeft className="h-3.5 w-3.5" />
					</button>
					<button
						data-browser-input
						className={iconButton}
						disabled={!active || !active.forward}
						onClick={() => active && void useBrowserStore.getState().action(active.id, "forward")}
						aria-label="Forward"
					>
						<ArrowRight className="h-3.5 w-3.5" />
					</button>
					<button
						data-browser-input
						className={iconButton}
						disabled={!active}
						onClick={() =>
							active &&
							void useBrowserStore.getState().action(active.id, active.loading ? "stop" : "reload")
						}
						aria-label={active?.loading ? "Stop" : "Reload"}
					>
						{active?.loading ? (
							<Loader2 className="h-3.5 w-3.5 animate-spin" />
						) : (
							<RotateCw className="h-3.5 w-3.5" />
						)}
					</button>
					<form onSubmit={handleNavigateInput} className="ml-1 flex min-w-0 flex-1">
						<input
							data-browser-input
							ref={addressRef}
							value={address}
							onChange={(event) => setAddress(event.target.value)}
							onFocus={(event) => event.currentTarget.select()}
							onKeyDown={(event) => {
								if (event.key === "Escape") event.currentTarget.blur();
							}}
							placeholder="Search or enter address"
							className="h-7 w-full min-w-0 rounded border border-pi-border bg-pi-surface-raised px-2.5 text-xs text-pi-text placeholder:text-pi-text-muted focus:outline-none focus:ring-1 focus:ring-pi-accent"
							spellCheck={false}
							autoComplete="off"
						/>
					</form>
					{findOpen && (
						<div data-browser-input className="flex items-center gap-1">
							<input
								data-browser-input
								autoFocus
								value={findQuery}
								onChange={(event) => setFindQuery(event.target.value)}
								placeholder="Find in page"
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										void useBrowserStore
											.getState()
											.find((event.target as HTMLInputElement).value, event.shiftKey);
									} else if (event.key === "Escape") {
										setFindOpen(false);
									}
								}}
								className="h-7 w-36 rounded border border-pi-border bg-pi-surface-raised px-2 text-xs text-pi-text placeholder:text-pi-text-muted focus:outline-none"
							/>
							<button
								data-browser-input
								className={iconButton}
								aria-label="Find previous"
								onClick={() => setFindOpen(false)}
							>
								<ChevronUp className="h-3.5 w-3.5" />
							</button>
							<button
								data-browser-input
								className={iconButton}
								aria-label="Find next"
								disabled={!findQuery}
								onClick={() => findQuery && void useBrowserStore.getState().find(findQuery, false)}
							>
								<ChevronDown className="h-3.5 w-3.5" />
							</button>
						</div>
					)}
					<button
						data-browser-input
						className={iconButton}
						onClick={() => setFindOpen((value) => !value)}
						aria-label="Find in page"
					>
						<Search className="h-3.5 w-3.5" />
					</button>
					<div data-browser-input className="flex items-center rounded border border-pi-border">
						<button
							data-browser-input
							className="flex h-7 w-6 cursor-pointer items-center justify-center text-pi-text-secondary hover:text-pi-text disabled:cursor-default disabled:opacity-40"
							disabled={!active}
							onClick={() =>
								active &&
								void useBrowserStore
									.getState()
									.setZoom(active.id, Math.max(0.25, zoomValue - 0.25))
									.then(() => setZoomValue(Math.max(0.25, zoomValue - 0.25)))
							}
							aria-label="Zoom out"
						>
							<span className="text-xs">−</span>
						</button>
						<button
							data-browser-input
							className="flex h-7 w-8 cursor-pointer items-center justify-center border-x border-pi-border text-[10px] text-pi-text-muted disabled:cursor-default disabled:opacity-40"
							disabled={!active || zoomValue === 1}
							onClick={() =>
								active && void useBrowserStore.getState().setZoom(active.id, 1).then(() => setZoomValue(1))
							}
							aria-label="Reset zoom"
						>
							{Math.round(zoomValue * 100)}%
						</button>
						<button
							data-browser-input
							className="flex h-7 w-6 cursor-pointer items-center justify-center text-pi-text-secondary hover:text-pi-text disabled:cursor-default disabled:opacity-40"
							disabled={!active}
							onClick={() =>
								active &&
								void useBrowserStore
									.getState()
									.setZoom(active.id, Math.min(5, zoomValue + 0.25))
									.then(() => setZoomValue(Math.min(5, zoomValue + 0.25)))
							}
							aria-label="Zoom in"
						>
							<span className="text-xs">+</span>
						</button>
					</div>
					<button
						data-browser-input
						className={iconButton}
						disabled={!active}
						onClick={() => active && void useBrowserStore.getState().setMuted(active.id, !active.muted)}
						aria-label={active?.muted ? "Unmute tab" : "Mute tab"}
					>
						{active?.muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
					</button>
					<button
						data-browser-input
						className={iconButton}
						disabled={!active || capturing}
						onClick={() => void handleCapture()}
						aria-label="Capture page screenshot"
					>
						{capturing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
					</button>
				</div>
			</div>

			{/* Page area: the native webviews are placed here by Rust. */}
			<div ref={pageAreaRef} className="relative min-h-0 flex-1" />

			{/* Download approvals */}
			{downloads.length > 0 && (
				<div className="pointer-events-auto absolute bottom-3 right-3 z-10 flex w-80 flex-col gap-2">
					{downloads.map((prompt) => (
						<div
							key={prompt.id}
							className="rounded-md border border-pi-border bg-pi-bg p-3 text-xs shadow-lg"
						>
							<div className="truncate font-medium text-pi-text">{prompt.name}</div>
							<div className="mt-0.5 truncate text-pi-text-muted">{prompt.site || prompt.url}</div>
							<div className="mt-2 flex gap-2">
								<button
									onClick={() => void decideDownload(prompt.id, "save")}
									className="cursor-pointer rounded bg-pi-accent px-2.5 py-1 font-medium text-white transition-hover hover:opacity-90"
								>
									Save
								</button>
								<button
									onClick={() => void decideDownload(prompt.id, "cancel")}
									className="cursor-pointer rounded border border-pi-border px-2.5 py-1 text-pi-text-secondary transition-hover hover:bg-pi-surface-raised"
								>
									Cancel
								</button>
							</div>
						</div>
					))}
				</div>
			)}

			{/* Capture overlay: the screenshot an agent (or user) sees. */}
			{captureUrl && active && (
				<div className="absolute inset-0 z-10 flex flex-col bg-pi-bg/95">
					<div className="flex items-center justify-between border-b border-pi-border px-3 py-2">
						<span className="text-xs font-medium text-pi-text">Capture — {active.title}</span>
						<div className="flex gap-2">
							<button
								onClick={() => {
									void navigator.clipboard.writeText(active.url);
									useBrowserStore.getState().dismissCapture(active.id);
								}}
								className="cursor-pointer rounded border border-pi-border px-2 py-1 text-xs text-pi-text-secondary hover:bg-pi-surface-raised"
							>
								Copy page URL
							</button>
							<button
								onClick={() => useBrowserStore.getState().dismissCapture(active.id)}
								className="cursor-pointer rounded border border-pi-border px-2 py-1 text-xs text-pi-text-secondary hover:bg-pi-surface-raised"
							>
								Back to page
							</button>
						</div>
					</div>
					<div className="min-h-0 flex-1 overflow-auto p-3">
						<img src={captureUrl} alt="Captured page" className="mx-auto max-w-full rounded border border-pi-border" />
					</div>
				</div>
			)}

			{/* Unsupported platform: proxied reading frames when the gateway is
			    available (Linux / macOS < 14), else the system browser. */}
			{!supported &&
				(gateway ? (
					<div className="relative min-h-0 flex-1 bg-white">
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
				) : (
					<div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
						<Globe className="h-8 w-8 text-pi-text-muted" />
						<p className="text-sm text-pi-text">Native browsing needs macOS 14+ or Windows.</p>
						<p className="max-w-sm text-xs text-pi-text-muted">
							Open tabs in your default browser here; the panel's secure proxy and page views
							arrive with this platform in a follow-up.
						</p>
						<button
							onClick={() => active?.url && openExternalLink(active.url)}
							className="cursor-pointer rounded border border-pi-border px-3 py-1.5 text-xs text-pi-text-secondary hover:bg-pi-surface-raised"
						>
							Open {active ? "this page" : "your browser"} externally
						</button>
					</div>
				))}
		</div>
	);
}