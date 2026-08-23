/**
 * CommandPalette — app-wide ⌘K command palette.
 *
 * Provides searchable access to all app actions: navigation, session
 * management, theme switching, model selection, tool toggles, etc.
 * Uses a simple filter + keyboard navigation pattern (no external deps).
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { Search } from 'lucide-react';

export interface CommandItem {
	id: string;
	label: string;
	hint?: string;
	keybinding?: string;
	icon?: React.ReactNode;
	group: 'session' | 'navigate' | 'tools' | 'settings' | 'view';
	action: () => void;
}

interface CommandPaletteProps {
	open: boolean;
	commands: CommandItem[];
	onClose: () => void;
}

const GROUP_LABELS: Record<CommandItem['group'], string> = {
	session: 'Session',
	navigate: 'Navigate',
	tools: 'Tools',
	settings: 'Settings',
	view: 'View',
};

const GROUP_ORDER: CommandItem['group'][] = ['session', 'navigate', 'view', 'tools', 'settings'];

export function CommandPalette({ open, commands, onClose }: CommandPaletteProps) {
	const [query, setQuery] = useState('');
	const [selectedIndex, setSelectedIndex] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	// Filter commands by query.
	const filtered = useMemo(() => {
		if (!query.trim()) return commands;
		const needle = query.trim().toLowerCase();
		return commands.filter(
			(item) =>
				item.label.toLowerCase().includes(needle) ||
				item.hint?.toLowerCase().includes(needle) ||
				item.group.toLowerCase().includes(needle)
		);
	}, [commands, query]);

	// Group commands by their group, ordered.
	const grouped = useMemo(() => {
		const groups = new Map<CommandItem['group'], CommandItem[]>();
		for (const item of filtered) {
			const list = groups.get(item.group) ?? [];
			list.push(item);
			groups.set(item.group, list);
		}
		return GROUP_ORDER.filter((g) => groups.has(g)).map((g) => ({ group: g, items: groups.get(g)! }));
	}, [filtered]);

	// Flatten for index-based selection.
	const flat = useMemo(() => grouped.flatMap((g) => g.items), [grouped]);

	// Reset on open.
	useEffect(() => {
		if (open) {
			setQuery('');
			setSelectedIndex(0);
			const id = requestAnimationFrame(() => inputRef.current?.focus());
			return () => cancelAnimationFrame(id);
		}
		return undefined;
	}, [open]);

	// Reset selection when query changes.
	useEffect(() => {
		setSelectedIndex(0);
	}, [query]);

	// Scroll selected item into view.
	useEffect(() => {
		const el = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
		if (el instanceof HTMLElement) {
			el.scrollIntoView({ block: 'nearest' });
		}
	}, [selectedIndex]);

	function execute(item: CommandItem) {
		item.action();
		onClose();
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
			event.preventDefault();
			onClose();
		}
	}

	// Global keyboard shortcuts while the palette is open.
	useEffect(() => {
		if (!open) return undefined;

		function handleGlobalKeyDown(event: KeyboardEvent) {
			if (event.key === 'Escape') {
				event.preventDefault();
				onClose();
			}
		}

		window.addEventListener('keydown', handleGlobalKeyDown, { capture: true });
		return () => window.removeEventListener('keydown', handleGlobalKeyDown, { capture: true });
	}, [open, onClose]);

	if (!open) return null;

	return createPortal(
		<div
			className="fixed inset-0 flex items-start justify-center pt-[15vh]"
			style={{ zIndex: 'var(--z-top)' }}
		>
			{/* Backdrop */}
			<div
				className="fixed inset-0 bg-black/50 backdrop-blur-[2px]"
				onClick={onClose}
			/>
			{/* Panel */}
			<div
				className="relative w-full max-w-lg overflow-hidden rounded-xl border border-[var(--pi-border)] bg-[var(--pi-surface-overlay)] shadow-2xl"
				role="dialog"
				aria-label="Command palette"
			>
				{/* Input */}
				<div className="flex items-center gap-2 border-b border-[var(--pi-border)] px-3 py-2.5">
					<Search className="size-4 shrink-0 text-[var(--pi-text-muted)]" />
					<input
						ref={inputRef}
						className="w-full bg-transparent text-sm text-[var(--pi-text)] outline-none placeholder:text-[var(--pi-text-muted)]"
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={handleKeyDown}
						placeholder="Type a command..."
						spellCheck={false}
						value={query}
					/>
				</div>

				{/* Results */}
				<div ref={listRef} className="max-h-[50vh] overflow-y-auto py-1">
					{flat.length === 0 ? (
						<div className="px-3 py-6 text-center text-sm text-[var(--pi-text-muted)]">
							No commands found for "{query}"
						</div>
					) : (
						grouped.map(({ group, items }) => (
							<div key={group}>
								<div className="px-3 pb-0.5 pt-2 text-[0.625rem] font-medium uppercase tracking-[0.08em] text-[var(--pi-text-faint)]">
									{GROUP_LABELS[group]}
								</div>
								{items.map((item) => {
									const index = flat.indexOf(item);
									const selected = index === selectedIndex;
									return (
										<button
											key={item.id}
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
											{item.keybinding && (
												<kbd className="shrink-0 rounded border border-[var(--pi-border)] bg-[var(--pi-surface)] px-1.5 py-0.5 text-[0.625rem] text-[var(--pi-text-muted)]">
													{item.keybinding}
												</kbd>
											)}
										</button>
									);
								})}
							</div>
						))
					)}
				</div>

				{/* Footer */}
				<div className="flex items-center gap-4 border-t border-[var(--pi-border)] px-3 py-2 text-[0.6875rem] text-[var(--pi-text-faint)]">
					<span className="flex items-center gap-1">
						<kbd className="rounded border border-[var(--pi-border)] px-1">↑↓</kbd> navigate
					</span>
					<span className="flex items-center gap-1">
						<kbd className="rounded border border-[var(--pi-border)] px-1">↵</kbd> run
					</span>
					<span className="flex items-center gap-1">
						<kbd className="rounded border border-[var(--pi-border)] px-1">esc</kbd> close
					</span>
				</div>
			</div>
		</div>,
		document.body,
	);
}