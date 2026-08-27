import { useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import * as rpc from "../lib/rpc";
import { useTabsStore } from "../stores/tabs-store";
import { useSessionStore } from "../stores/session-store";
import { useRuntimeStatusStore } from "../stores/runtime-status-store";
import { toast } from "../stores/toast-store";
import { pickLoadingVerb } from "../lib/loading-verbs";

/** Top-of-main session tab strip — the OpenCode-style "open sessions" row.
 *  Each tab is a session file; clicking switches the engine, the "+" starts a
 *  new session, and the close button drops the tab (switching to a neighbor, or
 *  starting a new session if it was the last one). */
export function SessionTabs() {
	const tabs = useTabsStore((s) => s.tabs);
	const activePath = useTabsStore((s) => s.activePath);
	const closeTab = useTabsStore((s) => s.closeTab);
	const setActive = useTabsStore((s) => s.setActive);
	const isStreaming = useSessionStore((s) => s.isStreaming);
	const bgRunning = useRuntimeStatusStore((s) => s.running);
	const finishedWhileAway = useRuntimeStatusStore((s) => s.finishedWhileAway);
	const bgRuntimeCount = useRuntimeStatusStore(
		(s) => Object.keys(s.running).filter((p) => p !== activePath).length,
	);
	const [pendingPath, setPendingPath] = useState<string | null>(null);

	const switchTo = async (path: string) => {
		if (path === activePath || pendingPath) return;
		setPendingPath(path);
		try {
			// Optimistically show the new tab as active so the UI feels instant.
			setActive(path);
			const result = await rpc.switchSession(path);
			// Re-attached to a runtime with an in-flight turn: show the streaming
			// state immediately instead of waiting for the next message event.
			if (result.reattached && result.snapshot?.running) {
				const store = useSessionStore.getState();
				if (!store.isStreaming) {
					store.setIsStreaming(true);
					store.setStreamingVerb(pickLoadingVerb());
				}
			}
		} catch (e) {
			// Revert on failure.
			setActive(activePath ?? "");
			toast.error("Failed to switch session", e instanceof Error ? e.message : String(e));
		} finally {
			setPendingPath((current) => (current === path ? null : current));
		}
	};

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
		<div className="flex h-9 shrink-0 items-stretch gap-0.5 border-b border-pi-border bg-pi-surface/70 px-1.5 backdrop-blur">
			<div className="flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto">
				{tabs.map((tab) => {
					const active = tab.path === activePath;
					const busyTab = active && isStreaming;
					const switching = pendingPath === tab.path;
					return (
						<div
							key={tab.path}
							className={`group/tab my-1 flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs transition-hover ${
								active
									? "bg-pi-surface-raised text-pi-text"
									: "text-pi-text-muted hover:bg-pi-surface-raised/60 hover:text-pi-text"
							}`}
						>
							<button
								type="button"
								onClick={() => void switchTo(tab.path)}
								disabled={!!pendingPath}
								className="max-w-40 truncate focus-visible:outline-none disabled:cursor-default"

							>
								{switching ? (
									<span className="inline-flex items-center gap-1.5">
										<Loader2 className="h-3 w-3 animate-spin" aria-hidden />
										<span className="truncate">{tab.name || "Untitled session"}</span>
									</span>
								) : (
									<span className="truncate">{tab.name || "Untitled session"}</span>
								)}
							</button>
							<button
								type="button"
								onClick={() => void onClose(tab.path)}
								className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-pi-text-faint opacity-0 transition-all hover:bg-pi-surface-overlay hover:text-pi-text group-hover/tab:opacity-100 focus-visible:opacity-100"

								aria-label="Close tab"
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
								<span
									className="h-1.5 w-1.5 shrink-0 rounded-full bg-pi-accent"
									aria-hidden
								/>
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
				className="my-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-pi-text-muted transition-hover hover:bg-pi-surface-raised hover:text-pi-text focus-visible:shadow-focus focus-visible:outline-none"

				aria-label="New session"
			>
				<Plus className="h-3.5 w-3.5" />
			</button>
		</div>
	);
}
