// Find-in-page for the native views: incremental search as the query changes,
// Enter/Shift+Enter to step, and an honest empty state (the native find returns
// whether the page matched at all). Esc closes it through the shared layer
// order, so a palette above it keeps its own Escape.

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import { ESCAPE_PRIORITY, isTopEscapeLayer, pushEscapeLayer } from "../../lib/escape-layers";
import { useBrowserStore } from "../../stores/browser-store";
import { IconButton } from "../ui/Button";

export function BrowserFindBar({
	open,
	tabId,
	onClose,
}: {
	open: boolean;
	tabId: string | null;
	onClose: () => void;
}) {
	const find = useBrowserStore((state) => state.find);
	const [query, setQuery] = useState("");
	const [found, setFound] = useState<boolean | null>(null);
	const inputRef = useRef<HTMLInputElement | null>(null);

	// Fresh query per open and per tab switch.
	useEffect(() => {
		if (!open) return;
		setQuery("");
		setFound(null);
		const frame = requestAnimationFrame(() => inputRef.current?.select());
		return () => cancelAnimationFrame(frame);
	}, [open, tabId]);

	// Incremental: highlight while typing; the page's own find keeps the
	// selection, so the delay only avoids one native call per keystroke.
	useEffect(() => {
		if (!open || !tabId) return;
		if (!query.trim()) {
			setFound(null);
			return;
		}
		const timer = window.setTimeout(() => {
			void find(query, false).then(setFound);
		}, 140);
		return () => window.clearTimeout(timer);
	}, [open, tabId, query, find]);

	useEffect(() => {
		if (!open) return;
		const unregister = pushEscapeLayer(ESCAPE_PRIORITY.findBar);
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || event.defaultPrevented) return;
			if (!isTopEscapeLayer(ESCAPE_PRIORITY.findBar)) return;
			event.preventDefault();
			onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => {
			unregister();
			document.removeEventListener("keydown", onKey);
		};
	}, [open, onClose]);

	if (!open || !tabId) return null;

	const step = (backwards: boolean) => {
		if (!query.trim()) return;
		void find(query, backwards).then(setFound);
	};

	return (
		<div
			data-browser-input
			role="search"
			aria-label="Find in page"
			className="absolute right-3 top-3 z-popover flex items-center gap-1 rounded-lg border border-pi-border bg-pi-surface-overlay px-1.5 py-1 shadow-overlay"
		>
			<Search className="h-3 w-3 shrink-0 text-pi-text-muted" />
			<input
				ref={inputRef}
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						step(event.shiftKey);
					}
				}}
				placeholder="Find in page"
				aria-label="Find in page"
				spellCheck={false}
				autoComplete="off"
				className="h-6 w-40 min-w-0 bg-transparent text-xs text-pi-text placeholder:text-pi-text-muted focus:outline-none"
			/>
			{query.trim() && (
				<span
					className="shrink-0 pr-1 text-3xs tabular-nums text-pi-text-faint"
					aria-live="polite"
				>
					{found === false ? "No matches" : found ? "Match" : ""}
				</span>
			)}
			<IconButton
				size="sm"
				icon={ChevronUp}
				aria-label="Previous match"
				disabled={!query.trim()}
				onClick={() => step(true)}
			/>
			<IconButton
				size="sm"
				icon={ChevronDown}
				aria-label="Next match"
				disabled={!query.trim()}
				onClick={() => step(false)}
			/>
			<IconButton size="sm" icon={X} aria-label="Close find bar" onClick={onClose} />
		</div>
	);
}
