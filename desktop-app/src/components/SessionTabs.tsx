import { useCallback, useEffect, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import * as rpc from "../lib/rpc";
import { useTabsStore } from "../stores/tabs-store";
import { useSessionStore } from "../stores/session-store";
import { performSessionSwitch } from "../lib/session-switch";
import { useRuntimeStatusStore } from "../stores/runtime-status-store";
import { useSessionTranscriptsStore } from "../stores/session-transcripts-store";
import { useSwitchStore } from "../stores/switch-store";
import { toast } from "../stores/toast-store";

function TabUnreadDot({ path, active }: { path: string; active: boolean }) {
	const unread = useSessionTranscriptsStore((s) => s.transcripts[path]?.unread ?? 0);
	if (active || unread === 0) return null;
	return <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-pi-accent" aria-label={`${unread} unread background updates`} />;
}

/** Top-of-main session tab strip — the OpenCode-style "open sessions" row.
 *  Each tab is a session file; clicking switches the engine, the "+" starts a
 *  new session, and the close button drops the tab (switching to a neighbor, or
 *  starting a new session if it was the last one). Tabs drag to reorder and
 *  close on middle click; ⌘⇧[ / ⌘⇧] cycle like browser tabs. */
export function SessionTabs() {
	const tabs = useTabsStore((s) => s.tabs);
	const activePath = useTabsStore((s) => s.activePath);
	const closeTab = useTabsStore((s) => s.closeTab);
	const moveTab = useTabsStore((s) => s.moveTab);
	const isStreaming = useSessionStore((s) => s.isStreaming);
	const pending = useSwitchStore((s) => s.pending);
	const bgRunning = useRuntimeStatusStore((s) => s.running);
	const finishedWhileAway = useRuntimeStatusStore((s) => s.finishedWhileAway);
	const bgRuntimeCount = useRuntimeStatusStore(
		(s) => Object.keys(s.running).filter((p) => p !== activePath).length,
	);
	const [dragPath, setDragPath] = useState<string | null>(null);
	const busy = Boolean(pending);

	const switchTo = useCallback(
		async (path: string) => {
			if (path === activePath || useSwitchStore.getState().pending) return;
			const tab = useTabsStore.getState().tabs.find((entry) => entry.path === path);
			await performSessionSwitch(path, { name: tab?.name ?? null });
		},
		[activePath],
	);

	const cycle = useCallback(
		(direction: 1 | -1) => {
			const state = useTabsStore.getState();
			if (state.tabs.length < 2 || useSwitchStore.getState().pending) return;
			const index = state.tabs.findIndex((tab) => tab.path === state.activePath);
			const next = state.tabs[(index + direction + state.tabs.length) % state.tabs.length];
			if (next) void performSessionSwitch(next.path, { name: next.name });
		},
		[],
	);

	// Browser-style session cycling. `code` keeps it working on layouts where
	// Shift turns the bracket into `{`/`}`.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.defaultPrevented || !(event.metaKey || event.ctrlKey) || !event.shiftKey) return;
			if (event.code !== "BracketLeft" && event.code !== "BracketRight") return;
			event.preventDefault();
			cycle(event.code === "BracketRight" ? 1 : -1);
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [cycle]);

	const startNew = async () => {
		try {
			await rpc.sendCommand({ type: "new_session" });
		} catch (e) {
			toast.error("Failed to start new session", e instanceof Error ? e.message : String(e));
		}
	};

	const onClose = async (path: string) => {
		// Don't close the active tab mid-stream — the engine is writing to it.
		// Switching TO another tab mid-stream is allowed: the engine aborts the
		// in-flight turn and persists it as an aborted message before switching.
		if (path === activePath && isStreaming) return;
		const next = closeTab(path);
		if (next) {
			await switchTo(next);
		} else if (tabs.length <= 1) {
			await startNew();
		}
	};

	if (tabs.length === 0) return null;

	return (
		<div className="relative" aria-busy={busy}>
			<div className="flex h-9 shrink-0 items-stretch gap-0.5 border-b border-pi-border bg-pi-surface/70 px-1.5 backdrop-blur">
				<div role="tablist" aria-label="Open sessions" className="flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto">
					{tabs.map((tab) => {
						const active = tab.path === activePath;
						const busyTab = active && isStreaming;
						const switching = pending?.kind === "session" && pending.path === tab.path;
						return (
							<div
								key={tab.path}
								role="tab"
								aria-selected={active}
								draggable={!busy}
								onDragStart={() => setDragPath(tab.path)}
								onDragEnd={() => setDragPath(null)}
								onDragOver={(event) => {
									if (dragPath) event.preventDefault();
								}}
								onDrop={(event) => {
									event.preventDefault();
									if (dragPath && dragPath !== tab.path) moveTab(dragPath, tab.path);
									setDragPath(null);
								}}
								onAuxClick={(event) => {
									if (event.button === 1) {
										event.preventDefault();
										void onClose(tab.path);
									}
								}}
								className={`group/tab relative my-1 flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs transition-hover ${
									active
										? "bg-pi-surface-raised text-pi-text"
										: "text-pi-text-muted hover:bg-pi-surface-raised/60 hover:text-pi-text"
								} ${dragPath === tab.path ? "opacity-50" : ""}`}
							>
								{active && (
									<span className="absolute inset-x-1.5 -top-px h-0.5 rounded-full bg-pi-accent" />
								)}
								<button
									type="button"
									onClick={() => void switchTo(tab.path)}
									disabled={busy && !switching}
									className="max-w-40 truncate text-left focus-visible:outline-none disabled:cursor-default"
								>
									{switching ? (
										<span className="inline-flex items-center gap-1.5">
											<Loader2 className="h-3 w-3 animate-spin" aria-hidden />
											<span className="truncate">{tab.name || "Untitled session"}</span>
										</span>
									) : (
										<span className="flex min-w-0 items-center gap-1.5">
											<span className="truncate">{tab.name || "Untitled session"}</span>
											<TabUnreadDot path={tab.path} active={active} />
										</span>
									)}
								</button>
								<button
									type="button"
									onClick={() => void onClose(tab.path)}
									disabled={busy}
									className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-pi-text-faint opacity-0 transition-all hover:bg-pi-surface-overlay hover:text-pi-text disabled:cursor-default group-hover/tab:opacity-100 focus-visible:opacity-100"
									aria-label={`Close ${tab.name || "session"}`}
								>
									<X className="h-3 w-3" />
								</button>
								{/* Background turn still streaming on this session. */}
								{!active && bgRunning[tab.path] && (
									<span
										className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-pi-accent"
										aria-label="running in background"
									/>
								)}
								{/* A background turn finished since the last visit. */}
								{!active && !bgRunning[tab.path] && finishedWhileAway[tab.path] && (
									<span
										className="h-1.5 w-1.5 shrink-0 rounded-full bg-pi-success"
										aria-label="turn finished"
									/>
								)}
								{switching && !busyTab && (
									<span className="h-1.5 w-1.5 shrink-0 rounded-full bg-pi-accent" aria-hidden />
								)}
							</div>
						);
					})}
				</div>
				{bgRuntimeCount > 0 && (
					<span
						className="my-1 flex h-7 shrink-0 items-center rounded-md px-2 font-mono text-3xs text-pi-text-faint"
						title={`${bgRuntimeCount} background session${bgRuntimeCount === 1 ? "" : "s"} live in the engine`}
					>
						{bgRuntimeCount} live
					</span>
				)}
				<button
					type="button"
					onClick={() => void startNew()}
					disabled={busy}
					className="my-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text disabled:cursor-default disabled:opacity-40 focus-visible:shadow-focus focus-visible:outline-none"
					aria-label="New session"
				>
					<Plus className="h-3.5 w-3.5" />
				</button>
			</div>
			{pending && (
				<div className="absolute inset-x-0 -bottom-px h-0.5 overflow-hidden" aria-hidden>
					<div className="switch-progress h-full w-1/3 rounded-full bg-pi-accent/70" />
				</div>
			)}
		</div>
	);
}
