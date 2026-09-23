import * as rpc from "../lib/rpc";
import { adoptSwitchResult } from "./adopt-session";
import { useTabsStore } from "../stores/tabs-store";
import { toast } from "../stores/toast-store";

/**
 * Open a session file (a cron run's side session, an activity-inbox item) as
 * the active tab: ensure a tab exists, switch the engine to it, and adopt the
 * authoritative switch result. Shared by the run-history and activity UIs.
 */
export async function openSessionFile(path: string): Promise<boolean> {
	useTabsStore.getState().openTab(path);
	try {
		const result = await rpc.switchSession(path);
		adoptSwitchResult(result);
		return true;
	} catch (e) {
		toast.error("Failed to open session", e instanceof Error ? e.message : String(e));
		return false;
	}
}