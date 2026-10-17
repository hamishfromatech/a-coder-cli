import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { X, GripHorizontal } from "lucide-react";
import { rendererLog } from "../../lib/renderer-log";

/** Tauri's manual resize-direction strings (Window.startResizeDragging). */
type ResizeDirection = "East" | "North" | "NorthEast" | "NorthWest" | "South" | "SouthEast" | "SouthWest" | "West";
import * as rpc from "../../lib/rpc";
import { processAgentEvent, mergeUserEchoes } from "../../lib/agent-event-pipeline";
import { MessageList } from "../MessageList";
import { Composer } from "../Composer";
import { useSessionStore, type QuestionUiRequest } from "../../stores/session-store";

/** Pull the authoritative engine state into the stores — a condensed copy of
 *  App's syncEngineState covering what the HUD renders (identity, model pill,
 *  streaming state, counts). Dedupe with App's version when the app window
 *  itself is refactored onto store-level sync. **Also flips the session
 *  status to connected** — App does that in its own connect path, but the HUD
 *  window never runs App, so without it the composer stays "not connected". */
async function hudSyncEngineState(): Promise<void> {
	try {
		const s = (await rpc.sendCommand({ type: "get_state" })) as {
			model?: { provider: string; id: string; name?: string };
			thinkingLevel?: string;
			permissionMode?: import("../../stores/session-store").PermissionMode;
			sessionName?: string;
			sessionFile?: string;
			messageCount?: number;
			pendingMessageCount?: number;
		};
		const store = useSessionStore.getState();
		store.setStatus("connected");
		if (s?.model) store.setModel(s.model as never);
		if (s?.thinkingLevel) store.setThinkingLevel(s.thinkingLevel);
		if (s?.permissionMode) store.setPermissionMode(s.permissionMode);
		store.setSessionName(s?.sessionName ?? null);
		store.setSessionFile(s?.sessionFile ?? null);
		if (typeof s?.messageCount === "number") store.setMessageCount(s.messageCount);
		if (typeof s?.pendingMessageCount === "number") store.setPendingMessageCount(s.pendingMessageCount);
		try {
			const cmds = await rpc.getCommands();
			store.setAvailableCommands(cmds.commands ?? []);
		} catch {
			// slash catalog is best-effort in the HUD
		}
	} catch (e) {
		console.warn("[hud] state sync failed", e);
	}
}

/**
 * The chrome-free floating chat surface (HUD mode). Runs the same event
 * pipeline as the main window against the same stores, renders the real
 * message list + composer with a drag-region grip on top.
 */
export function HudShell() {
	const loadingHistoryRef = useRef(true);
	const sessionStartGenerationRef = useRef(0);
	const parkedQuestionsRef = useRef<Map<string, QuestionUiRequest>>(new Map());
	// User echoes deferred by the history latch during the boot fetch.
	const deferredUserEchoesRef = useRef<import("@earendil-works/pi-agent-core").AgentMessage[]>([]);
	const sessionName = useSessionStore((s) => s.sessionName);
	const connected = useSessionStore((s) => Boolean(s.sessionFile || s.sessionId));

	useEffect(() => {
		let unlisten: (() => void) | null = null;
		let disposed = false;

		void (async () => {
			loadingHistoryRef.current = true;
			// Register BEFORE the state fetches: same boot-window race as the main
			// window — late registration drops the events of a first message.
			const u = await rpc.onRpcEvent((event) => {
				processAgentEvent(event, {
					loadingHistoryRef,
					sessionStartGenerationRef,
					parkedQuestionsRef: parkedQuestionsRef.current,
					deferredUserEchoesRef,
					syncEngineState: hudSyncEngineState,
				});
			});
			if (disposed) u();
			else unlisten = u;
			// The engine is already connected by the main window — this window only
			// paints state and listens; it never spawns a second engine.
			await hudSyncEngineState();
			let fetchedMessages: import("@earendil-works/pi-agent-core").AgentMessage[] | undefined;
			try {
				const msgsRes = (await rpc.sendCommand({ type: "get_messages" })) as {
					messages: import("@earendil-works/pi-agent-core").AgentMessage[];
				};
				fetchedMessages = msgsRes?.messages;
			} catch (e) {
				console.warn("[hud] history load failed", e);
			} finally {
				// Latch off, then drain deferred user echoes into the snapshot —
				// single setMessages, mirroring the main window's boot flow.
				loadingHistoryRef.current = false;
				const deferred = deferredUserEchoesRef.current;
				deferredUserEchoesRef.current = [];
				if (fetchedMessages || deferred.length > 0) {
					useSessionStore
						.getState()
						.setMessages(fetchedMessages ? mergeUserEchoes(fetchedMessages, deferred) : deferred);
				}
			}

			// Drag/close failures log to the shared renderer diagnostics sink —
			// startDragging in a transparent undecorated WKWebView is opaque to
			// reason about otherwise.
			const w = getCurrentWindow();
			if (import.meta.env.DEV) rendererLog(`[hud] mounted label=${w.label}`);
		})();

		return () => {
			disposed = true;
			unlisten?.();
		};
	}, []);

	const win = getCurrentWindow();

	const beginDrag = (e: React.PointerEvent) => {
		// Explicit API call — the injected data-tauri-drag-region listener is
		// flaky in a transparent, undecorated WKWebView window.
		e.preventDefault();
		rendererLog("[hud] drag begin");
		win.startDragging().catch((e) => rendererLog(`[hud] drag failed: ${e}`));
	};

	const beginResize = (e: React.PointerEvent, direction: ResizeDirection) => {
		e.preventDefault();
		e.stopPropagation();
		rendererLog("[hud] resize begin " + direction);
		win.startResizeDragging(direction).catch((e) => rendererLog(`[hud] resize failed: ${e}`));
	};

	const closeHud = () => {
		rendererLog("[hud] close click");
		getCurrentWindow()
			.close()
			.catch((e) => rendererLog(`[hud] close failed: ${e}`));
	};

	return (
		<div className="relative h-screen p-1.5">
			{/* Manual resize handles: a frameless macOS window exposes no native
			    edge hot-zones, so small hit areas drive startResizeDragging. */}
			{(
				[
					{ dir: "West", pos: "left-0 top-1.5 bottom-1.5 w-1.5 cursor-w-resize" },
					{ dir: "East", pos: "right-0 top-1.5 bottom-1.5 w-1.5 cursor-e-resize" },
					{ dir: "North", pos: "top-0 left-1.5 right-1.5 h-1.5 cursor-n-resize" },
					{ dir: "South", pos: "bottom-0 left-1.5 right-1.5 h-1.5 cursor-s-resize" },
					{ dir: "NorthWest", pos: "top-0 left-0 h-3 w-3 cursor-nw-resize" },
					{ dir: "NorthEast", pos: "top-0 right-0 h-3 w-3 cursor-ne-resize" },
					{ dir: "SouthWest", pos: "bottom-0 left-0 h-3 w-3 cursor-sw-resize" },
					{ dir: "SouthEast", pos: "bottom-0 right-0 h-3 w-3 cursor-se-resize" },
				] as const
			).map(({ dir, pos }) => (
				<div
					key={dir}
					onPointerDown={(e) => beginResize(e, dir)}
					className={`absolute z-30 ${pos}`}
				/>
			))}

			<div className="flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#101016]/90 shadow-2xl backdrop-blur-xl">
				{/* Grip strip: drag region for the whole bar except the buttons. */}
				<header className="flex h-9 shrink-0 items-center gap-2 px-3">
					<div
						data-tauri-drag-region
						onPointerDown={beginDrag}
						className="flex h-full min-w-0 flex-1 cursor-grab items-center gap-2"
					>
						<GripHorizontal className="h-3.5 w-3.5 shrink-0 text-white/35" data-tauri-drag-region />
						<span className="truncate text-2xs font-semibold text-white/80" data-tauri-drag-region>
							{sessionName || (connected ? "Session" : "Connecting…")}
						</span>
						<span className="text-2xs text-white/40" data-tauri-drag-region>
							HUD
						</span>
					</div>
					<button
						type="button"
						onClick={closeHud}
						aria-label="Close HUD"
						className="rounded-md p-1 text-white/50 hover:bg-white/10 hover:text-white"
					>
						<X className="h-3.5 w-3.5" />
					</button>
				</header>

				<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3">
					<MessageList />
				</div>

				<div className="shrink-0 px-2 pb-2">
					<Composer />
				</div>
			</div>
		</div>
	);
}