// Right-click menu on a session tab: close it, close the other tabs, copy
// its URL, or close the whole session. Escape or any click outside the menu
// dismisses it. In layered mode the root carries `data-browser-input` so the
// menu's rect is reported to the page layer and its clicks land here, not on
// the page underneath.

import { useEffect, useRef } from "react";
import { useBrowserStore } from "../../stores/browser-store";
import { ESCAPE_PRIORITY, isTopEscapeLayer, pushEscapeLayer } from "../../lib/escape-layers";

const MENU_WIDTH = 176;
const MENU_HEIGHT = 148;

const menuItem =
	"w-full cursor-pointer px-3 py-1.5 text-left text-xs text-pi-text transition-hover hover:bg-pi-surface-raised disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent";

export function TabContextMenu({
	tabId,
	left,
	top,
	onClose,
}: {
	tabId: string;
	left: number;
	top: number;
	onClose: () => void;
}) {
	const menuRef = useRef<HTMLDivElement | null>(null);
	const exists = useBrowserStore((state) => state.tabs.some((tab) => tab.id === tabId));
	const soleTab = useBrowserStore((state) => state.tabs.length <= 1);
	const hasUrl = useBrowserStore((state) => Boolean(state.tabs.find((tab) => tab.id === tabId)?.url));
	const closeTab = useBrowserStore((state) => state.close);
	const closeOthers = useBrowserStore((state) => state.closeOthers);
	const closeAll = useBrowserStore((state) => state.closeAll);
	const copyUrl = useBrowserStore((state) => state.copyUrl);

	useEffect(() => {
		const unregister = pushEscapeLayer(ESCAPE_PRIORITY.contextMenu); // while open
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				if (event.defaultPrevented || !isTopEscapeLayer(ESCAPE_PRIORITY.contextMenu)) return;
				event.preventDefault();
				onClose();
			}
		};
		const onDown = (event: MouseEvent) => {
			if (menuRef.current && !menuRef.current.contains(event.target as Node)) onClose();
		};
		document.addEventListener("keydown", onKey);
		document.addEventListener("mousedown", onDown);
		return () => {
			unregister();
			document.removeEventListener("keydown", onKey);
			document.removeEventListener("mousedown", onDown);
		};
	}, [onClose]);

	if (!exists) return null;
	// Clamp the fixed rect so the menu never spills past the window edge.
	const x = Math.max(8, Math.min(left, window.innerWidth - MENU_WIDTH - 8));
	const y = Math.max(8, Math.min(top, window.innerHeight - MENU_HEIGHT - 8));
	return (
		<div
			ref={menuRef}
			role="menu"
			aria-label="Tab actions"
			data-browser-input
			className="fixed z-50 w-44 rounded border border-pi-border bg-pi-bg py-1 shadow-lg"
			style={{ left: x, top: y }}
		>
			<button
				role="menuitem"
				className={menuItem}
				onClick={() => {
					void closeTab(tabId);
					onClose();
				}}
			>
				Close tab
			</button>
			<button
				role="menuitem"
				className={menuItem}
				disabled={soleTab}
				onClick={() => {
					void closeOthers(tabId);
					onClose();
				}}
			>
				Close other tabs
			</button>
			<button
				role="menuitem"
				className={menuItem}
				disabled={!hasUrl}
				onClick={() => {
					void copyUrl(tabId);
					onClose();
				}}
			>
				Copy URL
			</button>
			<button
				role="menuitem"
				className={menuItem}
				onClick={() => {
					void closeAll();
					onClose();
				}}
			>
				Close all tabs
			</button>
		</div>
	);
}