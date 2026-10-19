/**
 * Background-session subscription lifecycle. The engine forwards tagged events
 * for at most four detached runtimes; this keeps subscriptions aligned with
 * the runtime registry (subscribe while a background turn runs, drop when it
 * settles or becomes active).
 */

import * as rpc from "./rpc";
import type { RuntimeSessionStatus } from "./rpc";
import { useSessionStore } from "../stores/session-store";
import { useSessionTranscriptsStore } from "../stores/session-transcripts-store";
import { setCachedSessionMessages } from "./session-cache";

const MAX_SUBSCRIPTIONS = 4;

/** Seed a background transcript from its runtime history (tail page). */
async function seedHistory(sessionPath: string): Promise<void> {
	try {
		const page = await rpc.getMessages({ limit: 120, sessionPath });
		if (!page?.messages) return;
		useSessionTranscriptsStore.getState().update(sessionPath, (previous) => ({
			...previous,
			messages: page.messages,
			total: page.total ?? page.messages.length,
			start: page.start ?? 0,
			hasMoreOlder: (page.start ?? 0) > 0,
			lastActivity: Date.now(),
		}));
		setCachedSessionMessages(sessionPath, page.messages);
	} catch {
		// History seeding is best-effort; live events still fill the transcript.
	}
}

export async function ensureBackgroundSubscription(sessionPath: string): Promise<void> {
	const state = useSessionTranscriptsStore.getState();
	if (state.subscribed[sessionPath]) return;
	if (sessionPath === useSessionStore.getState().sessionFile) return;
	if (Object.keys(state.subscribed).length >= MAX_SUBSCRIPTIONS) return;
	state.setSubscribed(sessionPath, true);
	try {
		const result = await rpc.subscribeSession(sessionPath);
		if (!result.subscribed) {
			useSessionTranscriptsStore.getState().setSubscribed(sessionPath, false);
			return;
		}
		void seedHistory(sessionPath);
	} catch {
		useSessionTranscriptsStore.getState().setSubscribed(sessionPath, false);
	}
}

export async function dropBackgroundSubscription(sessionPath: string): Promise<void> {
	if (!useSessionTranscriptsStore.getState().subscribed[sessionPath]) return;
	useSessionTranscriptsStore.getState().setSubscribed(sessionPath, false);
	try {
		await rpc.unsubscribeSession(sessionPath);
	} catch {
		// The runtime may already be gone; the local state is what matters.
	}
}

/** Reconcile subscriptions with the latest runtime registry snapshot. */
export function syncBackgroundSubscriptions(
	sessions: RuntimeSessionStatus[],
	activePath: string | null,
): void {
	const running = new Set(
		sessions
			.filter((session) => !session.active && session.running && session.sessionFile)
			.map((session) => session.sessionFile as string),
	);
	for (const sessionPath of running) {
		if (sessionPath !== activePath) void ensureBackgroundSubscription(sessionPath);
	}
	for (const sessionPath of Object.keys(useSessionTranscriptsStore.getState().subscribed)) {
		if (sessionPath === activePath || !running.has(sessionPath)) {
			void dropBackgroundSubscription(sessionPath);
		}
	}
}
