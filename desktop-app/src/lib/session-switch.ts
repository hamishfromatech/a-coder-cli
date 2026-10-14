/**
 * Resilient session switching: every switch surface routes through here.
 *
 * The engine's switch asserts that a session's stored working directory
 * still exists (`missingSessionCwdError`) — the TUI recovers from that with
 * a "continue in current cwd" prompt, but in RPC mode it is just a thrown
 * error, which read as the mysterious "Failed to switch session" toast on
 * any session whose project folder was moved or deleted. When that is the
 * failure, retry the switch against the current workspace directory.
 */

import { useWorkspaceStore } from "../stores/workspace-store";
import { switchSession, type SwitchSessionResult } from "./rpc";
import { toast } from "../stores/toast-store";

/** Stable prefix of the engine's missing-session-cwd error message. */
export const MISSING_CWD_PREFIX = "Stored session working directory does not exist";

export async function runSwitch(sessionPath: string): Promise<SwitchSessionResult> {
	try {
		return await switchSession(sessionPath);
	} catch (e) {
		const message = e instanceof Error ? e.message : String(e);
		if (!message.includes(MISSING_CWD_PREFIX)) throw e;
		const cwd = useWorkspaceStore.getState().current;
		if (!cwd) throw e;
		const result = await switchSession(sessionPath, cwd);
		toast.warning("Opened in current folder", `The session's original folder no longer exists (${cwd}).`);
		return result;
	}
}