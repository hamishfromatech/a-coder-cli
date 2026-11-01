/**
 * Quick Open (⌘P): fuzzy file jump built on the bounded workspace file index
 * (`ide_index_files`) rather than a depth-walked tree, so it stays instant on
 * large repositories. `path:42` opens at a line. Enter opens, Esc closes.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { indexWorkspaceFiles } from "../../lib/rpc.ts";
import { openWorkspaceFile } from "../../lib/ide.ts";
import { parseFileLocation, relativeDir } from "../../lib/quick-open.ts";
import { useIdeStore } from "../../stores/ide-store";
import { cn } from "../../lib/cn.ts";

const INDEX_TTL_MS = 10_000;

/** Root → recently fetched index. Kept across opens so ⌘P is instant twice. */
const indexCache = new Map<string, { at: number; files: string[] }>();

/** Drop the cached index after the explorer creates/renames/deletes a file. */
export function invalidateQuickOpenIndex(root?: string): void {
	if (root) indexCache.delete(root);
	else indexCache.clear();
}

interface QuickOpenProps {
	root: string;
	onClose: () => void;
}

/** Scored subsequence match; higher is better; null = no match.
 * Consecutive hits and word starts beat scattered ones; shorter wins ties. */
export function fuzzyScore(query: string, target: string): number | null {
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
	const [files, setFiles] = useState<string[] | null>(() => indexCache.get(root)?.files ?? null);
	const [selected, setSelected] = useState(0);
	const listRef = useRef<HTMLDivElement>(null);
	const parsed = parseFileLocation(query);
	const filter = parsed.path;

	const loadIndex = useCallback(
		async (force = false): Promise<void> => {
			const cached = indexCache.get(root);
			if (!force && cached && Date.now() - cached.at < INDEX_TTL_MS) {
				setFiles(cached.files);
				return;
			}
			try {
				const next = await indexWorkspaceFiles(root);
				indexCache.set(root, { at: Date.now(), files: next });
				setFiles(next);
			} catch {
				setFiles((prev) => prev ?? []);
			}
		},
		[root],
	);

	useEffect(() => {
		void loadIndex();
	}, [loadIndex]);

	// Agent writes while the picker is open: refresh after the burst.
	useEffect(() => {
		let timer: number | null = null;
		const onFiles = (): void => {
			if (timer !== null) window.clearTimeout(timer);
			timer = window.setTimeout(() => void loadIndex(true), 300);
		};
		window.addEventListener("a-coder:agent-files-changed", onFiles);
		return () => {
			window.removeEventListener("a-coder:agent-files-changed", onFiles);
			if (timer !== null) window.clearTimeout(timer);
		};
	}, [loadIndex]);

	const results = useMemo(() => {
		if (!files) return [];
		if (!filter) return files.slice(0, 60);
		const scored: Array<{ path: string; score: number }> = [];
		for (const rel of files) {
			const name = rel.split("/").at(-1) ?? rel;
			const byName = fuzzyScore(filter, name);
			const byPath = filter.length >= 2 ? fuzzyScore(filter, rel) : null;
			const score = Math.max(byName ?? -Infinity, (byPath ?? -Infinity) * 0.8);
			if (score > -Infinity) scored.push({ path: rel, score });
		}
		scored.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
		return scored.slice(0, 60).map((entry) => entry.path);
	}, [files, filter]);

	useEffect(() => {
		setSelected(0);
	}, [filter]);

	useEffect(() => {
		const row = listRef.current?.querySelector('[data-selected="true"]');
		row?.scrollIntoView({ block: "nearest" });
	}, [selected, results.length]);

	function open(rel: string): void {
		void openWorkspaceFile(root, rel).then(() => {
			if (parsed.line) {
				useIdeStore.getState().setPendingReveal({
					path: rel.startsWith("/") ? rel : `${root.replace(/[/\\]+$/, "")}/${rel}`,
					line: parsed.line,
					nonce: Date.now(),
				});
			}
		});
		onClose();
	}

	return (
		<div className="fixed inset-0 z-[85] flex items-start justify-center bg-black/25 pt-[12vh]" onClick={onClose}>
			<div
				className="w-[560px] max-w-[86vw] overflow-hidden rounded-xl border border-pi-border-strong bg-pi-surface-raised shadow-2xl"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center gap-2 border-b border-pi-border px-4">
					<span className="font-mono text-2xs text-pi-text-faint">⌘P</span>
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
								setSelected((s) => Math.min(s + 1, Math.max(0, results.length - 1)));
							} else if (e.key === "ArrowUp") {
								e.preventDefault();
								setSelected((s) => Math.max(s - 1, 0));
							} else if (e.key === "Enter") {
								e.preventDefault();
								const entry = results[selected];
								if (entry) open(entry);
							}
						}}
						placeholder="Go to file… (add :line to jump)"
						className="h-12 min-w-0 flex-1 bg-transparent text-sm text-pi-text outline-none placeholder:text-pi-text-faint"
					/>
					{parsed.line && (
						<span className="shrink-0 rounded bg-pi-accent-soft px-1.5 py-0.5 font-mono text-3xs text-pi-accent">
							line {parsed.line}
						</span>
					)}
				</div>
				<div ref={listRef} className="max-h-80 overflow-auto p-1">
					{files === null && <div className="px-3 py-4 text-xs text-pi-text-faint">Indexing files…</div>}
					{files !== null && results.length === 0 && (
						<div className="px-3 py-4 text-xs text-pi-text-faint">
							{filter ? "No matching files" : "No files"}
						</div>
					)}
					{results.map((rel, index) => {
						const name = rel.split("/").at(-1) ?? rel;
						return (
							<button
								key={rel}
								data-selected={index === selected}
								onClick={() => open(rel)}
								onMouseMove={() => setSelected(index)}
								className={cn(
									"flex w-full cursor-pointer items-baseline gap-2 rounded-md px-3 py-1.5 text-left text-xs transition-smooth",
									index === selected ? "bg-pi-accent-soft text-pi-text" : "text-pi-text-secondary",
								)}
							>
								<span className="shrink-0 font-medium">{name}</span>
								<span className="truncate font-mono text-2xs text-pi-text-faint">{relativeDir(rel)}</span>
							</button>
						);
					})}
				</div>
				<div className="flex items-center gap-3 border-t border-pi-border px-4 py-1.5 text-2xs text-pi-text-faint">
					<span>{files ? `${files.length} files` : "—"}</span>
					<span className="ml-auto">↑↓ navigate · ↵ open · esc close</span>
				</div>
			</div>
		</div>
	);
}
