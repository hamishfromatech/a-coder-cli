/**
 * Paginated transcript loading. The engine pages the live context array; a
 * page boundary never splits a tool call from its results (the engine walks
 * the start back to the owning assistant message).
 */

import * as rpc from "./rpc";
import { useSessionStore } from "../stores/session-store";

/** Initial tail page. Large enough to fill the viewport several times. */
export const HISTORY_PAGE_SIZE = 120;
/** Older pages are smaller; the user asks for them explicitly. */
export const HISTORY_OLDER_PAGE_SIZE = 100;

/** Apply a `get_messages` response to the store (tail or older page). */
export function applyHistoryPage(
	result: rpc.GetMessagesResult,
	mode: "replace" | "prepend" = "replace",
): void {
	const store = useSessionStore.getState();
	const total = result.total ?? result.messages.length;
	if (mode === "replace") {
		const start = result.start ?? 0;
		store.setHistoryPage(result.messages, Math.max(total, start + result.messages.length), start);
		return;
	}
	const start = result.start ?? Math.max(0, store.messagesStart - result.messages.length);
	store.prependHistoryPage(result.messages, start, total);
}

/** Load the next older page. No-op when history is exhausted or already loading. */
export async function loadOlderHistory(): Promise<number> {
	const store = useSessionStore.getState();
	if (store.loadingOlder || !store.hasMoreOlder) return 0;
	store.setLoadingOlder(true);
	try {
		const page = await rpc.getMessages({
			limit: HISTORY_OLDER_PAGE_SIZE,
			before: store.messagesStart,
		});
		applyHistoryPage(page, "prepend");
		return page.messages.length;
	} finally {
		useSessionStore.getState().setLoadingOlder(false);
	}
}
