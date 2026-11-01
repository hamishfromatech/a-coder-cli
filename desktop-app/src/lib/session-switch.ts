/**
 * Resilient session switching: every switch surface routes through here.
 *
 * The engine's switch asserts that a session's stored working directory
 * still exists (`missingSessionCwdError`) — the TUI recovers from that with
 * a "continue in current cwd" prompt, but in RPC mode it is just a thrown
 * error, which read as the mysterious "Failed to switch session" toast on
 * any session whose project folder was moved or deleted. When that is the
 * failure, retry the switch against the current workspace directory.
 *
 * `performSessionSwitch` is the single path all UI surfaces use: it claims the
 * shared switch slot, points the tab strip at the target immediately, adopts
 * the authoritative identity, and releases the slot. One switch at a time, and
 * every surface (tabs, sidebar, picker, home) shows the same pending state.
 */

import { useSwitchStore } from "../stores/switch-store";
import { useTabsStore } from "../stores/tabs-store";
import { adoptSwitchResult } from "./adopt-session";
import { pickLoadingVerb } from "./loading-verbs";
import { switchSession, type SwitchSessionResult } from "./rpc";
import { toast } from "../stores/toast-store";
import { useSessionStore } from "../stores/session-store";
import { useWorkspaceStore } from "../stores/workspace-store";

/** Stable prefix of the engine's missing-session-cwd error message. */
export const MISSING_CWD_PREFIX = "Stored session working directory does not exist";

export async function runSwitch(sessionPath: string): Promise<SwitchSessionResult> {
	try {
		return await switchSession(sessionPath);
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		const code = (e as { code?: string }).code;
		if (code !== "missing_session_cwd" && !message.includes(MISSING_CWD_PREFIX)) throw e;
		const cwd = useWorkspaceStore.getState().current;
		if (!cwd) throw e;
		const result = await switchSession(sessionPath, cwd);
		toast.warning("Opened in current folder", `The session's original folder no longer exists (${cwd}).`);
		return result;
	}
}

export interface PerformSwitchOptions {
	/** Label for the pending chip/tab before the engine reports a name. */
	name?: string | null;
	/** Caller already owns the shared slot (a project switch wrapping a resume). */
	skipGuard?: boolean;
	/** Suppress the failure toast; the caller reports it itself. */
	silent?: boolean;
}

/**
 * Switches sessions with shared feedback. Returns null when the switch was
 * refused (another one is in flight) or failed; failures are toasted unless
 * `silent`. A successful switch adopts the engine's identity and streaming
 * snapshot, so callers only need to use the UI.
 */
export async function performSessionSwitch(
	path: string,
	options: PerformSwitchOptions = {},
): Promise<SwitchSessionResult | null> {
	// A project switch wraps a resume: it owns the slot and reports failures.
	if (!options.skipGuard) {
		const started = useSwitchStore.getState().begin({
			kind: "session",
			path,
			name: options.name ?? null,
		});
		if (!started) return null;
	}

	const tabs = useTabsStore.getState();
	const previousActive = tabs.activePath;
	const hadTab = tabs.tabs.some((tab) => tab.path === path);
	// Optimistic: the tab strip and the transcript's pending chip point at the
	// target before the engine answers, so the click never feels unacknowledged.
	tabs.openTab(path, options.name ?? undefined);

	try {
		const result = await runSwitch(path);
		adoptSwitchResult(result);
		// Re-attached to a runtime with an in-flight turn: show the streaming
		// state immediately instead of waiting for the next message event.
		if (result.reattached && result.snapshot?.running) {
			const store = useSessionStore.getState();
			if (!store.isStreaming) {
				store.setIsStreaming(true);
				store.setStreamingVerb(pickLoadingVerb());
			}
		}
		return result;
	} catch (e) {
		// A tab opened speculatively for a switch that failed must not linger.
		if (!hadTab) useTabsStore.getState().closeTab(path);
		useTabsStore.getState().setActive(previousActive ?? "");
		if (!options.silent) {
			toast.error("Failed to switch session", e instanceof Error ? e.message : String(e));
		}
		return null;
	} finally {
		if (!options.skipGuard) useSwitchStore.getState().clear(path);
	}
}
