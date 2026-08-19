import { Terminal } from "lucide-react";
import { useEffect, useRef } from "react";
import type { SlashEntry } from "../../lib/commandRouter";

export interface CommandPaletteProps {
	open: boolean;
	query: string;
	entries: SlashEntry[];
	highlight: number;
	onSelect: (entry: SlashEntry) => void;
	onHighlight: (index: number) => void;
	onClose: () => void;
}

const SOURCE_COLORS: Record<SlashEntry["source"], string> = {
	builtin: "text-pi-accent",
	extension: "text-pi-text-muted",
	prompt: "text-pi-text-muted",
	skill: "text-pi-text-muted",
};

const SOURCE_LABEL: Record<SlashEntry["source"], string> = {
	builtin: "built-in",
	extension: "ext",
	prompt: "prompt",
	skill: "skill",
};

export function CommandPalette({
	open,
	query,
	entries,
	highlight,
	onSelect,
	onHighlight,
	onClose,
}: CommandPaletteProps) {
	const listRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const el = listRef.current?.querySelector(
			`[data-cmd-index="${highlight}"]`,
		) as HTMLElement | null;
		el?.scrollIntoView({ block: "nearest" });
	}, [highlight]);

	if (!open) return null;

	return (
		<div
			className="absolute bottom-full left-0 right-0 mb-1.5 overflow-hidden rounded-lg border border-pi-border bg-pi-surface-overlay shadow-overlay"
			onMouseDown={(e) => e.preventDefault()}
		>
			<div className="flex items-center gap-2 border-b border-pi-border px-3 py-2">
				<Terminal className="h-3.5 w-3.5 text-pi-text-muted" />
				<span className="font-mono text-xs text-pi-text-muted">/</span>
				<span className="text-xs text-pi-text">{query || <span className="text-pi-text-faint">Type a command…</span>}</span>
			</div>

			{entries.length === 0 ? (
				<div className="px-3 py-3 text-center text-xs text-pi-text-muted">
					No matching commands.
				</div>
			) : (
				<div ref={listRef} className="max-h-64 overflow-y-auto p-1">
					{entries.map((entry, idx) => (
						<button
							key={`${entry.source}:${entry.name}`}
							data-cmd-index={idx}
							type="button"
							onMouseEnter={() => onHighlight(idx)}
							onClick={() => onSelect(entry)}
							className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left transition-hover active-press focus-visible:shadow-focus focus-visible:outline-none ${
								idx === highlight
									? "bg-pi-surface-raised"
									: "hover:bg-pi-surface-raised/50"
							}`}
						>
							<div className="min-w-0 flex-1">
								<div className="flex items-center gap-2">
									<span className="font-mono text-xs font-medium text-pi-text">
										/{entry.name}
									</span>
									{entry.description && (
										<span className="truncate text-2xs text-pi-text-muted">
											{entry.description}
										</span>
									)}
								</div>
							</div>
							<span
								className={`font-mono text-4xs font-semibold uppercase tracking-wide ${SOURCE_COLORS[entry.source]}`}
							>
								{SOURCE_LABEL[entry.source]}
							</span>
						</button>
					))}
				</div>
			)}

			<div className="flex items-center justify-between border-t border-pi-border bg-pi-surface/40 px-3 py-1.5 text-3xs text-pi-text-faint">
				<div className="flex items-center gap-2">
					<Kbd>↑↓</Kbd>
					<span>navigate</span>
					<Kbd>↵</Kbd>
					<span>select</span>
					<Kbd>esc</Kbd>
					<span>close</span>
				</div>
				<button type="button" onClick={onClose} className="text-3xs text-pi-text-faint hover:text-pi-text-muted">
					dismiss
				</button>
			</div>
		</div>
	);
}

function Kbd({ children }: { children: React.ReactNode }) {
	return (
		<kbd className="rounded border border-pi-border bg-pi-surface-raised px-1 font-mono text-4xs text-pi-text-muted">
			{children}
		</kbd>
	);
}