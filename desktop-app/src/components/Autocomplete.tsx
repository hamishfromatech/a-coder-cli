import { useEffect, useMemo, useRef, useState } from "react";

export interface AutocompleteProps {
	/** Full current text of the input. */
	text: string;
	/** Cursor position within the text. */
	cursor: number;
	/** List of words/phrases to suggest from. */
	suggestions: string[];
	/** Called when the user accepts a suggestion. Receives the full replacement text and new cursor position. */
	onAccept: (replacement: string, newCursor: number) => void;
	/** Called when the autocomplete surface should be dismissed without accepting. */
	onClose: () => void;
}

export function Autocomplete({ text, cursor, suggestions, onAccept, onClose }: AutocompleteProps) {
	const [highlight, setHighlight] = useState(0);
	const listRef = useRef<HTMLDivElement>(null);

	const { query, start, end } = useMemo(() => {
		const before = text.slice(0, cursor);
		const after = text.slice(cursor);
		// Find the word boundary before the cursor.
		const match = /(\S+)$/.exec(before);
		if (!match) return { query: "", start: cursor, end: cursor };
		const word = match[1];
		const start = cursor - word.length;
		// Extend to include trailing non-space characters that are part of the same token.
		const trailingMatch = /^(\S*)/.exec(after);
		const end = cursor + (trailingMatch?.[1]?.length ?? 0);
		return { query: word, start, end };
	}, [text, cursor]);

	const matches = useMemo(() => {
		const q = query.toLowerCase();
		if (!q || q.length < 2) return [];
		return suggestions
			.filter((s) => s.toLowerCase().includes(q) || s.toLowerCase().startsWith(q))
			.slice(0, 8);
	}, [query, suggestions]);

	useEffect(() => {
		setHighlight(0);
	}, [query]);

	useEffect(() => {
		const el = listRef.current?.querySelector(`[data-ac-index="${highlight}"]`) as HTMLElement | null;
		el?.scrollIntoView({ block: "nearest" });
	}, [highlight]);

	if (matches.length === 0 || query.length < 2) return null;

	const accept = (value: string) => {
		const replacement = text.slice(0, start) + value + text.slice(end);
		onAccept(replacement, start + value.length);
	};

	return (
		<div
			ref={listRef}
			className="absolute bottom-full left-0 right-0 z-20 mb-1 overflow-hidden rounded-lg border border-pi-border bg-pi-surface-overlay shadow-overlay"
			onMouseDown={(e) => e.preventDefault()}
			onKeyDown={(e) => {
				if (e.key === "ArrowDown") {
					e.preventDefault();
					setHighlight((h) => (h + 1) % matches.length);
				} else if (e.key === "ArrowUp") {
					e.preventDefault();
					setHighlight((h) => (h - 1 + matches.length) % matches.length);
				} else if (e.key === "Enter" || e.key === "Tab") {
					e.preventDefault();
					accept(matches[highlight] ?? "");
				} else if (e.key === "Escape") {
					e.preventDefault();
					onClose();
				}
			}}
		>
			{matches.map((m, idx) => (
				<button
					key={m}
					data-ac-index={idx}
					type="button"
					onMouseEnter={() => setHighlight(idx)}
					onClick={() => accept(m)}
					className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs transition-hover ${
						idx === highlight ? "bg-pi-surface-raised" : "hover:bg-pi-surface-raised/50"
					}`}
				>
					<span className="text-pi-text">{m}</span>
				</button>
			))}
		</div>
	);
}
