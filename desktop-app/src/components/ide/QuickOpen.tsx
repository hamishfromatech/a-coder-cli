/**
 * Quick Open (⌘P): fuzzy file jump — VS Code's signature navigator. Flat
 * rel-path list from the workspace tree, scored subsequence match, keyboard
 * driven. Enter opens, Esc closes.
 */

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { listDirectory, type DirEntry } from "../../lib/rpc.ts";
import { openWorkspaceFile } from "../../lib/ide.ts";
import { cn } from "../../lib/cn.ts";

interface QuickOpenProps {
	root: string;
	onClose: () => void;
}

interface FlatFile {
	/** Relative path with '/' separators (the row's subtitle). */
	rel: string;
	/** File name (the row's title; matches weigh most). */
	name: string;
}

function flattenTree(entries: DirEntry[], depth: number, out: FlatFile[]): void {
	if (depth >= 10 || out.length >= 4000) return;
	for (const entry of entries) {
		if (entry.is_dir) {
			flattenTree(entry.children, depth + 1, out);
		} else {
			out.push({ rel: entry.path, name: entry.name });
		}
	}
}

/** Scored subsequence match; higher is better; null = no match.
 * Consecutive hits and word starts beat scattered ones; shorter wins ties. */
function fuzzyScore(query: string, target: string): number | null {
	if (!query) return 0;
	const haystack = target.toLowerCase();
	const needle = query.toLowerCase();
	// Cheap substring fast-path: strong score, scaled by earliness/shortness.
	const direct = haystack.indexOf(needle);
	if (direct >= 0) {
		return 1000 - direct * 2 - Math.max(0, haystack.length - needle.length);
	}
	let score = 0;
	let index = 0;
	let streak = 0;
	for (const char of needle) {
		const found = haystack.indexOf(char, index);
		if (found < 0) return null;
		const wordStart = found === 0 || /[\W_]/.test(haystack[found - 1] ?? "");
		score += wordStart ? 8 : 2;
		score += streak > 0 ? streak * 3 : 0;
		streak = found === index ? streak + 1 : 0;
		score -= found - index;
		index = found + 1;
	}
	return score - Math.floor(haystack.length / 8);
}

export function QuickOpen({ root, onClose }: QuickOpenProps): ReactNode {
	const [query, setQuery] = useState("");
	const [files, setFiles] = useState<FlatFile[] | null>(null);
	const [selected, setSelected] = useState(0);
	const listRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		let cancelled = false;
		void (async () => {
			try {
				const tree = await listDirectory(root, 10);
				if (cancelled) return;
				const flat: FlatFile[] = [];
				flattenTree(tree, 0, flat);
				setFiles(flat);
			} catch {
				if (!cancelled) setFiles([]);
			}
		})();
		return () => {
			cancelled = true;
		};
	}, [root]);

	const results = useMemo(() => {
		if (!files) return [];
		const scored: Array<{ file: FlatFile; score: number }> = [];
		for (const file of files) {
			const byName = fuzzyScore(query, file.name);
			const byPath = query.length >= 2 ? fuzzyScore(query, file.rel) : null;
			const score = Math.max(byName ?? -Infinity, (byPath ?? -Infinity) * 0.8);
			if (score > -Infinity) scored.push({ file, score });
		}
		scored.sort((a, b) => b.score - a.score || a.file.rel.length - b.file.rel.length);
		return scored.slice(0, 60).map((entry) => entry.file);
	}, [files, query]);

	useEffect(() => {
		setSelected(0);
	}, [query]);

	useEffect(() => {
		const row = listRef.current?.querySelector('[data-selected="true"]');
		row?.scrollIntoView({ block: "nearest" });
	}, [selected, results.length]);

	function open(entry: FlatFile): void {
		void openWorkspaceFile(root, entry.rel);
		onClose();
	}

	return (
		<div className="fixed inset-0 z-50 flex items-start justify-center bg-black/25 pt-[12vh]" onClick={onClose}>
			<div
				className="w-[540px] max-w-[86vw] overflow-hidden rounded-xl border border-pi-border-strong bg-pi-surface-raised shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<input
					autoFocus
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Escape") {
							e.preventDefault();
							onClose();
						} else if (e.key === "ArrowDown") {
							e.preventDefault();
							setSelected((s) => Math.min(s + 1, results.length - 1));
						} else if (e.key === "ArrowUp") {
							e.preventDefault();
							setSelected((s) => Math.max(s - 1, 0));
						} else if (e.key === "Enter") {
							e.preventDefault();
							const entry = results[selected];
							if (entry) open(entry);
						}
					}}
					placeholder="Go to file…"
					className="w-full border-b border-pi-border bg-transparent px-4 py-3 text-sm text-pi-text outline-none placeholder:text-pi-text-faint"
				/>
				<div ref={listRef} className="max-h-70 overflow-auto p-1">
					{files === null && <div className="px-3 py-4 text-xs text-pi-text-faint">Reading files…</div>}
					{files !== null && results.length === 0 && (
						<div className="px-3 py-4 text-xs text-pi-text-faint">
							{query ? "No matching files" : "No files"}
						</div>
					)}
					{results.map((entry, index) => (
						<button
							key={entry.rel}
							data-selected={index === selected}
							onClick={() => open(entry)}
							onMouseMove={() => setSelected(index)}
							className={cn(
								"flex w-full cursor-pointer items-baseline gap-2 rounded-md px-3 py-1.5 text-left text-xs transition-smooth",
								index === selected
									? "bg-pi-accent-soft text-pi-text"
									: "text-pi-text-secondary",
							)}
						>
							<span className="shrink-0 font-medium">{entry.name}</span>
							<span className="truncate font-mono text-2xs text-pi-text-faint">{relativeDir(entry.rel)}</span>
						</button>
					))}
				</div>
				<div className="flex items-center gap-3 border-t border-pi-border px-4 py-1.5 text-2xs text-pi-text-faint">
					<span>↑↓ navigate</span>
					<span>↵ open</span>
					<span className="ml-auto">esc close</span>
				</div>
			</div>
		</div>
	);
}

function relativeDir(rel: string): string {
	const parts = rel.split("/");
	return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
}