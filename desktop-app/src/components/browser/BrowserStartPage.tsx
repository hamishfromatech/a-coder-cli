// New-tab surface: a quiet start page instead of loading a search engine.
// Typing an address keeps everything local until the user submits; recent
// pages come from finished loads this app made. It also states what the agent
// may do on a page, so the permission pill in the toolbar has context.

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Globe, Search, Settings2 } from "lucide-react";
import { normalizeUrl } from "../../lib/normalize-url";
import { useBrowserRecentStore } from "../../stores/browser-recent-store";
import { cn } from "../../lib/cn";
import { TabFavicon } from "./TabFavicon";

function hostOf(url: string): string {
	try {
		return new URL(url).host;
	} catch {
		return url;
	}
}

export function BrowserStartPage({
	onNavigate,
	onOpenSettings,
	agentMode,
	externalOnly,
}: {
	onNavigate: (url: string) => void;
	onOpenSettings: () => void;
	agentMode: "ask" | "auto" | null;
	externalOnly: boolean;
}) {
	const [value, setValue] = useState("");
	const pages = useBrowserRecentStore((state) => state.pages).slice(0, 6);
	const inputRef = useRef<HTMLInputElement | null>(null);

	useEffect(() => {
		const frame = requestAnimationFrame(() => inputRef.current?.focus());
		return () => cancelAnimationFrame(frame);
	}, []);

	const submit = (event: React.FormEvent) => {
		event.preventDefault();
		const url = normalizeUrl(value);
		if (url) onNavigate(url);
	};

	return (
		<div className="flex h-full flex-col items-center overflow-y-auto bg-pi-bg px-6 py-10">
			<div className="w-full max-w-md">
				<div className="flex items-center gap-2.5">
					<span className="flex h-8 w-8 items-center justify-center rounded-lg border border-pi-border bg-pi-surface-raised shadow-ring">
						<Globe className="h-4 w-4 text-pi-text-secondary" />
					</span>
					<div className="min-w-0">
						<h1 className="text-sm font-semibold text-pi-text">New tab</h1>
						<p className="text-3xs text-pi-text-muted">
							{externalOnly
								? "Native pages need macOS 14+ or Windows; open a page here and it leaves for your browser."
								: "Type an address to browse, or ask the agent to open and read a page."}
						</p>
					</div>
				</div>

				<form
					onSubmit={submit}
					className="mt-6 flex items-center gap-2 rounded-lg border border-pi-border bg-pi-surface-raised px-3 py-2 shadow-ring transition-smooth focus-within:shadow-focus"
				>
					<Search className="h-4 w-4 shrink-0 text-pi-text-muted" />
					<input
						ref={inputRef}
						value={value}
						onChange={(event) => setValue(event.target.value)}
						placeholder="Search or enter address"
						aria-label="Search or enter address"
						spellCheck={false}
						autoComplete="off"
						className="h-6 min-w-0 flex-1 bg-transparent text-xs text-pi-text placeholder:text-pi-text-muted focus:outline-none"
					/>
					<kbd className="shrink-0 rounded border border-pi-border bg-pi-bg px-1 py-px font-mono text-3xs text-pi-text-faint">
						↵
					</kbd>
				</form>

				{pages.length > 0 && (
					<section className="mt-7">
						<h2 className="mb-1.5 px-2 text-3xs font-semibold uppercase tracking-wider text-pi-text-faint">
							Recent
						</h2>
						<ul className="flex flex-col">
							{pages.map((page) => (
								<li key={page.url}>
									<button
										type="button"
										onClick={() => onNavigate(page.url)}
										className="group flex w-full cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-hover hover:bg-pi-surface-raised focus-visible:shadow-focus focus-visible:outline-none"
									>
										<TabFavicon url={page.url} />
										<span className="min-w-0 flex-1 truncate text-xs text-pi-text">
											{page.title}
										</span>
										<span className="shrink-0 text-3xs text-pi-text-faint">
											{hostOf(page.url)}
										</span>
										<ArrowUpRight className="h-3 w-3 shrink-0 text-pi-text-faint opacity-0 transition-opacity group-hover:opacity-100" />
									</button>
								</li>
							))}
						</ul>
					</section>
				)}

				<div className="mt-8 flex items-center justify-between gap-3 border-t border-pi-border pt-3">
					{agentMode ? (
						<span className="min-w-0 text-3xs text-pi-text-muted">
							Agent{" "}
							<span
								className={cn(
									"font-medium",
									agentMode === "auto" ? "text-pi-text" : "text-pi-text-secondary",
								)}
							>
								{agentMode === "auto" ? "acts on ordinary sites" : "asks on a new site"}
							</span>
						</span>
					) : (
						<span className="min-w-0 text-3xs text-pi-text-muted">Local start page</span>
					)}
					<button
						type="button"
						onClick={onOpenSettings}
						className="flex shrink-0 cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 text-3xs text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
					>
						<Settings2 className="h-3 w-3" /> Browser settings
					</button>
				</div>
			</div>
		</div>
	);
}
