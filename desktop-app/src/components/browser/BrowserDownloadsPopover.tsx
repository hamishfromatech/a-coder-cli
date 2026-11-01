// Downloads, where the user looks for them: one popover for pending approvals
// (the gate saves nothing until asked) and the files this run already wrote.
// The settings surface keeps the full list; this one stays close to the page.

import { Download, FileDown, FolderOpen, Trash2 } from "lucide-react";
import browser from "../../lib/browser";
import { useBrowserStore } from "../../stores/browser-store";
import { BrowserPopover, MenuSeparator } from "./BrowserPopover";
import { IconButton } from "../ui/Button";
import { Tip } from "../ui/Tip";

function fileName(path: string): string {
	return path.split(/[/\\]/).pop() || path;
}

export function BrowserDownloadsPopover({
	open,
	onClose,
	onOpenSettings,
}: {
	open: boolean;
	onClose: () => void;
	onOpenSettings: () => void;
}) {
	const pending = useBrowserStore((state) => state.downloads);
	const recent = useBrowserStore((state) => state.recentDownloads);
	const decide = useBrowserStore((state) => state.decideDownload);
	const clearRecent = useBrowserStore((state) => state.clearRecentDownloads);

	return (
		<BrowserPopover open={open} onClose={onClose} label="Downloads" className="w-72">
			<div className="flex items-center justify-between px-2 pb-1 pt-1">
				<span className="text-3xs font-semibold uppercase tracking-wider text-pi-text-faint">
					Downloads
				</span>
				{pending.length === 0 && recent.length > 0 && (
					<button
						type="button"
						onClick={clearRecent}
						className="flex cursor-pointer items-center gap-1 rounded px-1 py-0.5 text-3xs text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
					>
						<Trash2 className="h-2.5 w-2.5" /> Clear
					</button>
				)}
			</div>

			{pending.length === 0 && recent.length === 0 && (
				<div className="flex flex-col items-center gap-1.5 px-3 py-6 text-center">
					<Download className="h-4 w-4 text-pi-text-faint" />
					<p className="text-2xs text-pi-text-muted">Nothing downloaded yet.</p>
				</div>
			)}

			{pending.map((prompt) => (
				<div key={prompt.id} className="rounded-md border border-pi-border bg-pi-bg p-2">
					<div className="flex items-start gap-2">
						<FileDown className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pi-text-muted" />
						<div className="min-w-0 flex-1">
							<div className="truncate text-xs font-medium text-pi-text">{prompt.name}</div>
							<div className="truncate text-3xs text-pi-text-muted">{prompt.site || prompt.url}</div>
						</div>
					</div>
					<div className="mt-2 flex justify-end gap-1.5">
						<button
							type="button"
							onClick={() => void decide(prompt.id, "cancel")}
							className="cursor-pointer rounded border border-pi-border px-2 py-0.5 text-3xs text-pi-text-secondary transition-hover hover:bg-pi-surface-raised hover:text-pi-text"
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={() => void decide(prompt.id, "save")}
							className="cursor-pointer rounded bg-pi-accent px-2 py-0.5 text-3xs font-medium text-white transition-hover hover:bg-pi-accent-hover"
						>
							Save
						</button>
					</div>
				</div>
			))}

			{recent.length > 0 && (
				<>
					{pending.length > 0 && <MenuSeparator />}
					<ul className="max-h-56 overflow-y-auto">
						{recent.map((item) => (
							<li key={`${item.path}-${item.at}`}>
								<div className="group flex items-center gap-2 rounded-md px-2 py-1.5 transition-hover hover:bg-pi-surface-raised">
									<FileDown className="h-3.5 w-3.5 shrink-0 text-pi-text-muted" />
									<Tip content={item.path} placement="control" className="min-w-0 flex-1">
										<span className="w-full truncate text-left text-xs text-pi-text">
											{fileName(item.path)}
										</span>
									</Tip>
									<span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
										<IconButton
											size="sm"
											icon={FolderOpen}
											aria-label={`Reveal ${fileName(item.path)}`}
											onClick={() => void browser.downloadReveal(item.path).catch(() => {})}
										/>
										<IconButton
											size="sm"
											icon={Download}
											aria-label={`Open ${fileName(item.path)}`}
											onClick={() => void browser.downloadOpen(item.path).catch(() => {})}
										/>
									</span>
								</div>
							</li>
						))}
					</ul>
				</>
			)}

			<div className="mt-1 border-t border-pi-border pt-1">
				<button
					type="button"
					onClick={onOpenSettings}
					className="w-full cursor-pointer rounded-md px-2 py-1 text-left text-3xs text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"
				>
					Download folder and settings…
				</button>
			</div>
		</BrowserPopover>
	);
}
