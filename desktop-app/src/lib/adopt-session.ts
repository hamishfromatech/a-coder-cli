/**
 * Session-switch adoption: apply the switch response's authoritative identity
 * (session file, id, name, workspace) to the stores immediately.
 *
 * The engine also announces the switch via the `session_start` event, whose
 * handler re-syncs from `get_state`; adopting the response here keeps session
 * tab labels and the workspace breadcrumb correct even when that event races
 * the optimistic UI update or is delayed, and — for switches across projects —
 * moves the workspace indicator to the session's own workspace.
 */

import { useSessionStore } from "../stores/session-store";
import { useWorkspaceStore } from "../stores/workspace-store";
import type { SwitchSessionResult } from "./rpc";
import { setAuthoritativeSession } from "./session-authority";

export function adoptSwitchResult(result: SwitchSessionResult): void {
	if (result.cancelled || !result.sessionFile) return;
	const store = useSessionStore.getState();
	if (store.sessionFile === result.sessionFile && store.sessionName === (result.sessionName ?? null)) {
		// The event path already adopted this session — nothing to change.
	} else {
		store.setSessionName(result.sessionName ?? null);
		if (result.sessionId) store.setSessionId(result.sessionId);
		store.setSessionFile(result.sessionFile);
	}
	setAuthoritativeSession(result.sessionFile);
	if (result.cwd) {
		store.setCwd(result.cwd);
		const workspace = useWorkspaceStore.getState();
		if (workspace.current !== result.cwd) {
			workspace.setCurrent(result.cwd);
		}
	}
}