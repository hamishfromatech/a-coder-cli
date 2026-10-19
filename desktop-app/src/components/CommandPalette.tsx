/**
 * CommandPalette — app-wide ⌘K command palette.
 *
 * Provides searchable access to all app actions: navigation, session
 * management, theme switching, model selection, tool toggles, etc.
 * Uses a simple filter + keyboard navigation pattern (no external deps).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FadeScroll } from "./ui/FadeScroll";

import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { ESCAPE_PRIORITY, isTopEscapeLayer, pushEscapeLayer } from '../lib/escape-layers';
import { readRecentCommands, recordRecentCommand } from '../lib/command-recents';

export interface CommandItem {
	id: string;
	label: string;
	hint?: string;
	keybinding?: string;
	icon?: React.ReactNode;
	group: 'session' | 'navigate' | 'tools' | 'settings' | 'view';
	/** Search aliases that are not shown in the row. */
	keywords?: string[];
	/** Nested page of commands; selecting the row opens it instead of closing. */
	children?: CommandItem[];
	/** Live preview while the row is highlighted (theme pickers). */
	onHighlight?: () => void;
	/** Keep the previewed value when this row runs instead of restoring it. */
	commitPreview?: boolean;
	action?: () => void;
}

interface CommandPaletteProps {
	open: boolean;
	commands: CommandItem[];
	onClose: () => void;
	/** Called when the palette closes without running a command (revert previews). */
	onDismiss?: () => void;
}

const GROUP_LABELS: Record<CommandItem['group'], string> = {
	session: 'Session',
	navigate: 'Navigate',
	tools: 'Tools',
	settings: 'Settings',
	view: 'View',
};

const GROUP_ORDER: CommandItem['group'][] = ['session', 'navigate', 'view', 'tools', 'settings'];

export function CommandPalette({ open, commands, onClose, onDismiss }: CommandPaletteProps) {
	const [query, setQuery] = useState('');
	const [selectedIndex, setSelectedIndex] = useState(0);
	const [pages, setPages] = useState<{ title: string; items: CommandItem[] }[]>([]);
	const [recentIds, setRecentIds] = useState<string[]>(() => readRecentCommands());
	const executedRef = useRef(false);
	const page = pages.at(-1);
	const commandsForPage = page?.items ?? commands;
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	// Filter commands by query.
	const filtered = useMemo(() => {
		if (!query.trim()) return commandsForPage;
		const needle = query.trim().toLowerCase();
		return commandsForPage.filter(
			(item) =>
				item.label.toLowerCase().includes(needle) ||
				item.hint?.toLowerCase().includes(needle) ||
				item.group.toLowerCase().includes(needle) ||
				item.keywords?.some((keyword) => keyword.toLowerCase().includes(needle))
		);
	}, [commandsForPage, query]);

	const recentItems = useMemo(() => {
		if (query.trim() || pages.length > 0) return [];
		const byId = new Map(commandsForPage.map((item) => [item.id, item]));
		return recentIds
			.map((id) => byId.get(id))
			.filter((item): item is CommandItem => Boolean(item));
	}, [commandsForPage, query, pages.length, recentIds]);
	const recentSet = useMemo(() => new Set(recentItems.map((item) => item.id)), [recentItems]);
	const baseFiltered = useMemo(
		() => filtered.filter((item) => !recentSet.has(item.id)),
		[filtered, recentSet],
	);

	// Group commands by their group, ordered.
	const grouped = useMemo(() => {
		const groups = new Map<CommandItem['group'], CommandItem[]>();
		for (const item of baseFiltered) {
			const list = groups.get(item.group) ?? [];
			list.push(item);
			groups.set(item.group, list);
		}
		return GROUP_ORDER.filter((g) => groups.has(g)).map((g) => ({ group: g, items: groups.get(g)! }));
	}, [baseFiltered]);

	const sections = useMemo(
		() => [
			...(recentItems.length > 0 ? [{ key: 'recent', label: 'Recent', items: recentItems }] : []),
			...grouped.map((group) => ({ key: group.group, label: GROUP_LABELS[group.group], items: group.items })),
		],
		[grouped, recentItems],
	);

	// Flatten for index-based selection.
	const flat = useMemo(() => sections.flatMap((section) => section.items), [sections]);

	// Reset on open.
	useEffect(() => {
		if (open) {
			setQuery('');
			setSelectedIndex(0);
			setPages([]);
			setRecentIds(readRecentCommands());
			executedRef.current = false;
			const id = requestAnimationFrame(() => inputRef.current?.focus());
			return () => cancelAnimationFrame(id);
		}
		return undefined;
	}, [open]);

	// Reset selection when query changes.
	useEffect(() => {
		setSelectedIndex(0);
	}, [query]);

	// Live preview for picker commands (theme) while a row is highlighted.
	useEffect(() => {
		if (!open) return;
		flat[selectedIndex]?.onHighlight?.();
	}, [flat, selectedIndex, open]);

	// Scroll selected item into view.
	useEffect(() => {
		const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
		if (el instanceof HTMLElement) {
			el.scrollIntoView({ block: 'nearest' });
		}
	}, [selectedIndex]);

	function execute(item: CommandItem) {
		if (item.children && item.children.length > 0) {
			setPages((current) => [...current, { title: item.label, items: item.children! }]);
			setQuery('');
			setSelectedIndex(0);
			return;
		}
		if (!item.commitPreview) onDismiss?.();
		executedRef.current = true;
		setRecentIds(recordRecentCommand(item.id));
		item.action?.();
		onClose();
	}

	function dismiss() {
		if (!executedRef.current) onDismiss?.();
		executedRef.current = false;
		onClose();
	}

	function goBack() {
		setPages((current) => current.slice(0, -1));
		setQuery('');
		setSelectedIndex(0);
	}

	function handleKeyDown(event: React.KeyboardEvent) {
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			setSelectedIndex((prev) => Math.min(flat.length - 1, prev + 1));
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			setSelectedIndex((prev) => Math.max(0, prev - 1));
		} else if (event.key === 'Enter') {
			event.preventDefault();
			const item = flat[selectedIndex];
			if (item) execute(item);
		} else if (event.key === 'Escape') {
			if (event.defaultPrevented) return;
			event.preventDefault();
			if (pages.length > 0) goBack();
			else dismiss();
		}
	}

	// Global keyboard shortcuts while the palette is open.
	useEffect(() => {
		if (!open) return undefined;

		const unregister = pushEscapeLayer(ESCAPE_PRIORITY.palette);
		function handleGlobalKeyDown(event: KeyboardEvent) {
			if (event.defaultPrevented || !isTopEscapeLayer(ESCAPE_PRIORITY.palette)) return;
			if (event.key === 'Escape') {
				event.preventDefault();
				if (pages.length > 0) goBack();
				else dismiss();
			}
		}

		window.addEventListener('keydown', handleGlobalKeyDown, { capture: true });
		return () => {
			unregister();
			window.removeEventListener('keydown', handleGlobalKeyDown, { capture: true });
		};
	}, [open, pages.length]);

	if (!open) return null;

	return createPortal(
		<div
			className="fixed inset-0 flex items-start justify-center pt-[15vh]"
			style={{ zIndex: 'var(--z-top)' }}
		>
			{/* Backdrop */}
			<div
				className="fixed inset-0 bg-black/50"
				onClick={dismiss}
			/>
			{/* Panel */}
			<div
				className="relative w-full max-w-lg overflow-hidden rounded-pi-xl border border-[var(--pi-border)] bg-[var(--pi-surface-overlay)] shadow-2xl"
				role="dialog"
				aria-label="Command palette"
			>
				{/* Input */}
				<div className="flex items-center gap-2 border-b border-[var(--pi-border)] px-3 py-2.5">
					{pages.length > 0 ? (
						<button
							type="button"
							onClick={goBack}
							className="flex size-5 shrink-0 items-center justify-center rounded-pi-sm text-[var(--pi-text-muted)] transition-colors hover:bg-[var(--pi-surface-raised)] hover:text-[var(--pi-text)]"
							aria-label="Back to commands"
						>
							<ChevronLeft className="size-3.5" />
						</button>
					) : (
						<Search className="size-4 shrink-0 text-[var(--pi-text-muted)]" />
					)}
					{pages.length > 0 && (
						<span className="shrink-0 text-xs text-[var(--pi-text-faint)]">
							{pages.map((entry) => entry.title).join(" / ")}
						</span>
					)}
					<input
						ref={inputRef}
						className="min-w-0 flex-1 bg-transparent text-sm text-[var(--pi-text)] outline-none placeholder:text-[var(--pi-text-muted)]"
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={handleKeyDown}
						aria-label="Command search"
						aria-controls="command-palette-list"
						aria-activedescendant={flat[selectedIndex] ? `command-option-${selectedIndex}` : undefined}
						placeholder="Type a command..."
						spellCheck={false}
						value={query}
					/>
				</div>

				{/* Results */}
				<FadeScroll
					className="max-h-[50vh] overflow-y-auto py-1"
					role="listbox"
					aria-label="Commands"
					id="command-palette-list"
				>
					{flat.length === 0 ? (
						<div className="px-3 py-6 text-center text-sm text-[var(--pi-text-muted)]">
							No commands found for "{query}"
						</div>
					) : (
						sections.map(({ key, label, items }) => (
							<div key={key}>
								<div className="px-3 pb-0.5 pt-2 text-[0.625rem] font-medium uppercase tracking-[0.08em] text-[var(--pi-text-faint)]">
									{label}
								</div>
								{items.map((item) => {
									const index = flat.indexOf(item);
									const selected = index === selectedIndex;
									return (
										<button
											key={item.id}
											id={`command-option-${index}`}
											role="option"
											aria-selected={selected}
											data-index={index}
											className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors"
											style={{
												background: selected ? 'var(--pi-accent-soft)' : 'transparent',
												color: selected ? 'var(--pi-text)' : 'var(--pi-text-secondary)',
											}}
											onClick={() => execute(item)}
											onMouseEnter={() => setSelectedIndex(index)}
											type="button"
										>
											{item.icon && <span className="shrink-0">{item.icon}</span>}
											<span className="min-w-0 flex-1 truncate">{item.label}</span>
											{item.hint && (
												<span className="shrink-0 text-xs text-[var(--pi-text-faint)]">{item.hint}</span>
											)}
											{item.children && item.children.length > 0 && (
												<ChevronRight className="size-3.5 shrink-0 text-[var(--pi-text-faint)]" />
											)}
											{item.keybinding && (
												<kbd className="shrink-0 rounded-pi-sm border border-[var(--pi-border)] bg-[var(--pi-surface)] px-1.5 py-0.5 text-[0.625rem] text-[var(--pi-text-muted)]">
													{item.keybinding}
												</kbd>
											)}
										</button>
									);
								})}
							</div>
						))
					)}
				</FadeScroll>

				{/* Footer */}
				<div className="flex items-center gap-4 border-t border-[var(--pi-border)] px-3 py-2 text-[0.6875rem] text-[var(--pi-text-faint)]">
					<span className="flex items-center gap-1">
						<kbd className="rounded-pi-sm border border-[var(--pi-border)] px-1">↑↓</kbd> navigate
					</span>
					<span className="flex items-center gap-1">
						<kbd className="rounded-pi-sm border border-[var(--pi-border)] px-1">↵</kbd> run
					</span>
					<span className="flex items-center gap-1">
						<kbd className="rounded-pi-sm border border-[var(--pi-border)] px-1">esc</kbd> close
					</span>
				</div>
			</div>
		</div>,
		document.body,
	);
}