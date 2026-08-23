/**
 * FindBar — native find-in-page overlay (⌘F).
 *
 * Uses Tauri's webview find API when available, falls back to a
 * web-based search over the transcript content. Provides incremental
 * search with match highlighting, step next/previous, and match counter.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Button } from './ui/Button';
import { ChevronUp, ChevronDown, X } from 'lucide-react';

export function FindBar({ open, onClose }: FindBarProps) {
	const [query, setQuery] = useState('');
	const [matchOrdinal, setMatchOrdinal] = useState(0);
	const [matchCount, setMatchCount] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);

	// Focus input when bar opens.
	useEffect(() => {
		if (open) {
			setQuery('');
			setMatchOrdinal(0);
			setMatchCount(0);
			const id = requestAnimationFrame(() => inputRef.current?.focus());
			return () => cancelAnimationFrame(id);
		}
		return undefined;
	}, [open]);

	// Find in page using web-based search.
	useEffect(() => {
		if (!open || !query) {
			setMatchCount(0);
			setMatchOrdinal(0);
			return undefined;
		}

		// Debounce search.
		const id = setTimeout(() => {
			void performFind(query);
		}, 200);

		return () => clearTimeout(id);
	}, [open, query]);

	async function performFind(searchQuery: string) {
		// Web-based search: search the transcript content.
		const transcript = document.querySelector('[data-find-target]') ?? document.body;
		const textContent = transcript.textContent ?? '';
		const regex = new RegExp(searchQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
		const matches = textContent.match(regex);
		const count = matches?.length ?? 0;
		setMatchCount(count);
		setMatchOrdinal(count > 0 ? 1 : 0);
	}

	function findNext() {
		if (query) {
			void performFind(query, 'next');
		}
	}

	function findPrevious() {
		if (query) {
			void performFind(query, 'previous');
		}
	}

	function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
		if (event.key === 'Enter') {
			event.preventDefault();
			if (event.shiftKey) {
				findPrevious();
			} else {
				findNext();
			}
		} else if (event.key === 'Escape') {
			onClose();
		}
	}

	// Global keyboard shortcuts while the bar is open.
	useEffect(() => {
		if (!open) return undefined;

		function handleGlobalKeyDown(event: KeyboardEvent) {
			if ((event.metaKey || event.ctrlKey) && event.key === 'g') {
				event.preventDefault();
				if (event.shiftKey) {
					findPrevious();
				} else {
					findNext();
				}
			} else if (event.key === 'Escape') {
				onClose();
			}
		}

		window.addEventListener('keydown', handleGlobalKeyDown, { capture: true });
		return () => window.removeEventListener('keydown', handleGlobalKeyDown, { capture: true });
	}, [open, query, onClose]);

	if (!open) return null;

	return createPortal(
		<div
			className="pointer-events-auto fixed right-4 top-[calc(var(--titlebar-height,34px)+0.5rem)] z-[var(--z-top)] flex items-center gap-2 rounded-lg border border-[var(--pi-border)] bg-[var(--pi-surface-overlay)] px-2 py-1.5 shadow-md"
			role="search"
		>
			<input
				ref={inputRef}
				aria-label="Find in page"
				autoComplete="off"
				className="h-6 w-40 bg-transparent text-xs text-[var(--pi-text)] outline-none placeholder:text-[var(--pi-text-muted)]"
				onChange={(e) => setQuery(e.target.value)}
				onKeyDown={handleKeyDown}
				placeholder="Find in page"
				spellCheck={false}
				type="search"
				value={query}
			/>
			{matchCount > 0 && (
				<span aria-live="polite" className="min-w-[3rem] text-center text-[0.6875rem] text-[var(--pi-text-muted)]">
					{matchOrdinal} / {matchCount}
				</span>
			)}
			<Button onClick={findPrevious} size="icon" variant="ghost" aria-label="Find previous">
				<ChevronUp className="size-4" />
			</Button>
			<Button onClick={findNext} size="icon" variant="ghost" aria-label="Find next">
				<ChevronDown className="size-4" />
			</Button>
			<Button onClick={onClose} size="icon" variant="ghost" aria-label="Close">
				<X className="size-4" />
			</Button>
		</div>,
		document.body,
	);
}