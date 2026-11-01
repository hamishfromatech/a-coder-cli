/**
 * Project search rail panel: bounded workspace scan via `ide_search_workspace`,
 * with case-sensitive / whole-word toggles, matches grouped by file, and
 * click-to-open at the line through the store's pendingReveal.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CaseSensitive, WholeWord } from "lucide-react";

import { searchWorkspace, type WorkspaceSearchMatch } from "../../lib/rpc.ts";
import { openWorkspaceFile } from "../../lib/ide.ts";
import { highlightSegments } from "../../lib/search-highlight.ts";
import { useIdeStore } from "../../stores/ide-store";
import { Tip } from "../ui/Tip";
import { cn } from "../../lib/cn.ts";

const DEBOUNCE_MS = 220;
/** The backend caps at 200 matches; keep the UI honest about it. */
const MATCH_CAP = 200;

interface SearchPanelProps {
	root: string;
}

interface FileGroup {
	path: string;
	matches: WorkspaceSearchMatch[];
}

export function SearchPanel({ root }: SearchPanelProps): ReactNode {
	const [query, setQuery] = useState("");
	const [caseSensitive, setCaseSensitive] = useState(false);
	const [wholeWord, setWholeWord] = useState(false);
	const [matches, setMatches] = useState<WorkspaceSearchMatch[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [searching, setSearching] = useState(false);
	const runId = useRef(0);

	const runSearch = useCallback(
		async (q: string, caseFlag: boolean, wordFlag: boolean) => {
			const trimmed = q.trim();
			if (!trimmed) {
				setMatches(null);
				setError(null);
				setSearching(false);
				return;
			}
			const id = ++runId.current;
			setSearching(true);
			try {
				const next = await searchWorkspace(root, trimmed, {
					caseSensitive: caseFlag,
					wholeWord: wordFlag,
				});
				if (id !== runId.current) return;
				setMatches(next);
				setError(null);
			} catch (e) {
				if (id !== runId.current) return;
				setMatches([]);
				setError(e instanceof Error ? e.message : String(e));
			} finally {
				if (id === runId.current) setSearching(false);
			}
		},
		[root],
	);

	// Debounce live typing and option flips.
	useEffect(() => {
		if (!query.trim()) {
			void runSearch("", caseSensitive, wholeWord);
			return;
		}
		const timer = setTimeout(() => void runSearch(query, caseSensitive, wholeWord), DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [query, caseSensitive, wholeWord, root, runSearch]);

	// The agent changed files: refresh an existing result set.
	const refresh = useCallback(() => {
		if (query.trim()) void runSearch(query, caseSensitive, wholeWord);
	}, [query, caseSensitive, wholeWord, runSearch]);
	useEffect(() => {
		window.addEventListener("a-coder:agent-files-changed", refresh);
		return () => window.removeEventListener("a-coder:agent-files-changed", refresh);
	}, [refresh]);

	function openAt(match: WorkspaceSearchMatch): void {
		const absolute = match.path.startsWith("/")
			? match.path
			: `${root.replace(/[/\\]+$/, "")}/${match.path}`;
		void openWorkspaceFile(root, absolute).then(() => {
			useIdeStore.getState().setPendingReveal({ path: absolute, line: match.line, nonce: Date.now() });
		});
	}

	const groups = useMemo<FileGroup[]>(() => {
		if (!matches) return [];
		const byPath = new Map<string, WorkspaceSearchMatch[]>();
		for (const match of matches) {
			const list = byPath.get(match.path) ?? [];
			list.push(match);
			byPath.set(match.path, list);
		}
		return [...byPath.entries()].map(([path, entries]) => ({ path, matches: entries }));
	}, [matches]);

	const optionClass = (active: boolean): string =>
		cn(
			"flex h-5 w-5 cursor-pointer items-center justify-center rounded transition-smooth focus-visible:shadow-focus focus-visible:outline-none",
			active
				? "bg-pi-accent-soft text-pi-accent"
				: "text-pi-text-faint hover:bg-pi-surface-raised hover:text-pi-text",
		);

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex h-8 shrink-0 items-center gap-1 border-b border-pi-border px-2">
				<input
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={(e) => {
						if (e.key === "Escape") setQuery("");
					}}
					placeholder="Search workspace…"
					autoFocus
					spellCheck={false}
					className="min-w-0 flex-1 rounded-md bg-pi-surface-raised px-2 py-1 text-xs text-pi-text outline-none placeholder:text-pi-text-faint"
				/>
				<Tip content="Match case" placement="toolbar">
					<button
						type="button"
						aria-label="Match case"
						aria-pressed={caseSensitive}
						onClick={() => setCaseSensitive((value) => !value)}
						className={optionClass(caseSensitive)}
					>
						<CaseSensitive className="size-3.5" />
					</button>
				</Tip>
				<Tip content="Whole word" placement="toolbar">
					<button
						type="button"
						aria-label="Whole word"
						aria-pressed={wholeWord}
						onClick={() => setWholeWord((value) => !value)}
						className={optionClass(wholeWord)}
					>
						<WholeWord className="size-3.5" />
					</button>
				</Tip>
			</div>
			<div className="flex h-6 shrink-0 items-center px-3 text-2xs text-pi-text-faint">
				{searching
					? "Searching…"
					: matches === null
						? "Type to search across the workspace"
						: `${matches.length} match${matches.length === 1 ? "" : "es"} in ${groups.length} file${groups.length === 1 ? "" : "s"}`}
				{matches !== null && matches.length >= MATCH_CAP && <span className="ml-1">(capped)</span>}
			</div>
			<div className="min-h-0 flex-1 overflow-auto pb-1 pr-1">
				{error && <div className="px-3 py-2 text-xs text-pi-error">{error}</div>}
				{groups.map((group) => (
					<div key={group.path} className="mb-1">
						<div className="sticky top-0 z-10 flex items-baseline gap-2 bg-pi-surface/95 px-3 py-1 backdrop-blur-sm">
							<span className="truncate font-mono text-2xs text-pi-text-secondary">{group.path}</span>
							<span className="ml-auto shrink-0 font-mono text-3xs text-pi-text-faint">
								{group.matches.length}
							</span>
						</div>
						{group.matches.map((match) => (
							<button
								key={`${match.path}:${match.line}`}
								onClick={() => openAt(match)}
								className="flex w-full cursor-pointer items-baseline gap-2 rounded px-3 py-1 text-left transition-smooth hover:bg-pi-surface-raised focus-visible:shadow-focus focus-visible:outline-none"
							>
								<span className="w-8 shrink-0 text-right font-mono text-3xs text-pi-text-faint">
									{match.line}
								</span>
								<span className="min-w-0 flex-1 truncate whitespace-pre font-mono text-2xs text-pi-text-muted">
									{highlightSegments(match.text, query, caseSensitive).map((segment, index) =>
										segment.hit ? (
											<mark
												key={index}
												className="rounded-[2px] bg-pi-accent/25 px-0.5 text-pi-text"
											>
												{segment.text}
											</mark>
										) : (
											<span key={index}>{segment.text}</span>
										),
									)}
								</span>
							</button>
						))}
					</div>
				))}
			</div>
		</div>
	);
}
