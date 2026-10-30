/**
 * Project search rail panel: bounded workspace text scan via
 * `ide_search_workspace`, click-to-open at line through the store's
 * pendingReveal which the editor group consumes.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import {
	searchWorkspace,
	type WorkspaceSearchMatch,
} from "../../lib/rpc.ts";
import { openWorkspaceFile } from "../../lib/ide.ts";
import { useIdeStore } from "../../stores/ide-store";
import { cn } from "../../lib/cn.ts";

const DEBOUNCE_MS = 250;

interface SearchPanelProps {
	root: string;
}

export function SearchPanel({ root }: SearchPanelProps): ReactNode {
	const [query, setQuery] = useState("");
	const [matches, setMatches] = useState<WorkspaceSearchMatch[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [searching, setSearching] = useState(false);
	const runId = useRef(0);

	const runSearch = useCallback(async (q: string) => {
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
			const next = await searchWorkspace(root, trimmed);
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
	}, [root]);

	// Re-run against root changes; debounce live typing.
	useEffect(() => {
		if (!query.trim()) {
			void runSearch("");
			return;
		}
		const timer = setTimeout(() => void runSearch(query), DEBOUNCE_MS);
		return () => clearTimeout(timer);
	}, [query, root, runSearch]);

	// The agent changed files: if we have a result set, refresh it.
	const refresh = useCallback(() => {
		if (query.trim()) void runSearch(query);
	}, [query, runSearch]);
	useEffect(() => {
		window.addEventListener("a-coder:agent-files-changed", refresh);
		return () => window.removeEventListener("a-coder:agent-files-changed", refresh);
	}, [refresh]);

	function openAt(match: WorkspaceSearchMatch): void {
		// matches carry workspace-relative paths; resolve to absolute first.
		const absolute = match.path.startsWith("/") ? match.path : `${root.replace(/\/+$/, "")}/${match.path}`;
		void openWorkspaceFile(root, absolute).then(() => {
			useIdeStore.getState().setPendingReveal({
				path: absolute,
				line: match.line,
				nonce: Date.now(),
			});
		});
	}

	const fileCount = matches ? new Set(matches.map((m) => m.path)).size : 0;

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex h-8 shrink-0 items-center gap-2 border-b border-pi-border px-2">
				<input
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					placeholder="Search workspace…"
					autoFocus
					className="min-w-0 flex-1 rounded-md bg-pi-surface-raised px-2 py-1 text-xs text-pi-text outline-none placeholder:text-pi-text-faint"
				/>
			</div>
			<div className="flex h-6 shrink-0 items-center px-3 text-2xs text-pi-text-faint">
				{searching
					? "Searching…"
					: matches === null
						? "Type to search across the workspace"
						: `${matches.length} match${matches.length === 1 ? "" : "es"} in ${fileCount} file${fileCount === 1 ? "" : "s"}`}
				{matches !== null && matches.length >= 200 && <span className="ml-1">(capped)</span>}
			</div>
			<div className="min-h-0 flex-1 overflow-auto py-1 pr-1">
				{error && <div className="px-3 py-2 text-xs text-pi-error">{error}</div>}
				{matches?.map((match, index) => (
					<button
						key={`${match.path}:${match.line}:${index}`}
						onClick={() => openAt(match)}
						className="flex w-full cursor-pointer flex-col gap-0.5 rounded px-3 py-1.5 text-left transition-smooth hover:bg-pi-surface-raised"
					>
						<span className="flex items-baseline gap-2">
							<span className="truncate font-mono text-2xs text-pi-text-secondary">{match.path}</span>
							<span className="shrink-0 font-mono text-2xs text-pi-text-faint">:{match.line}</span>
						</span>
						<span className={cn("truncate font-mono text-2xs text-pi-text-muted")}>{match.text}</span>
					</button>
				))}
			</div>
		</div>
	);
}