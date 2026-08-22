/**
 * Bash progress store — live mailbox for a running Bash command's output.
 *
 * While the Bash tool is blocked on `await`-ing the child process, there's no
 * path to yield events back into the agent loop. So the tool publishes stdout /
 * stderr chunks here keyed by the tool call id, and the UI subscribes to show
 * the command's tail live (last few lines + elapsed + line count).
 *
 * Throttling: a chatty command (npm install, a test run) emits data in bursts;
 * notifying on every chunk would repaint the whole live frame dozens of times
 * a second. We coalesce notifications to ~10fps (leading + trailing edge) so
 * the UI stays smooth, and always flush on completion.
 *
 * Heartbeat: output alone can't drive the UI — a silent command (sleep 600,
 * an npm install stuck resolving) would emit nothing and the card would freeze.
 * So while a command runs we also tick once a second, re-emitting the snapshot
 * so the live card re-renders and its elapsed clock advances.
 */

// Keep only the tail in memory — the model gets the full output from the
// tool's own accumulation; the store exists purely to feed the live preview.
const MAX_TAIL_LINES = 40;
const NOTIFY_INTERVAL_MS = 100;
const TICK_INTERVAL_MS = 1000;

export interface BashProgress {
	/** Tail of combined stdout+stderr (capped to MAX_TAIL_LINES). */
	output: string;
	/** Total lines seen so far (not just the retained tail). */
	totalLines: number;
	/** Total bytes seen so far. */
	totalBytes: number;
	/** Wall-clock start (ms since epoch) — used to derive elapsed. */
	startTime: number;
	/** Configured timeout (ms) — drives the live `timeout Xs` countdown hint. */
	timeoutMs?: number;
	/** True once the process has exited. */
	done: boolean;
}

type Listener = (toolCallId: string, snapshot: BashProgress | undefined) => void;

const store = new Map<string, BashProgress>();
const listeners = new Set<Listener>();

// Throttle bookkeeping, per tool id.
const lastNotifyAt = new Map<string, number>();
const trailingTimers = new Map<string, ReturnType<typeof setTimeout>>();
// Per-command heartbeat interval (the "still running, clock ticking" pulse).
const tickTimers = new Map<string, ReturnType<typeof setInterval>>();

function emit(toolCallId: string, snapshot: BashProgress | undefined): void {
	for (const l of listeners) {
		try {
			l(toolCallId, snapshot);
		} catch {
			// Never let a subscriber break a mutation.
		}
	}
}

function notifyThrottled(toolCallId: string): void {
	const now = Date.now();
	const last = lastNotifyAt.get(toolCallId) ?? 0;
	const elapsed = now - last;
	if (elapsed >= NOTIFY_INTERVAL_MS) {
		lastNotifyAt.set(toolCallId, now);
		emit(toolCallId, store.get(toolCallId));
		return;
	}
	// Within the cooldown — schedule a single trailing notify so the final
	// burst isn't lost (clear any already-scheduled one first).
	if (trailingTimers.has(toolCallId)) return;
	const timer = setTimeout(() => {
		trailingTimers.delete(toolCallId);
		lastNotifyAt.set(toolCallId, Date.now());
		emit(toolCallId, store.get(toolCallId));
	}, NOTIFY_INTERVAL_MS - elapsed);
	trailingTimers.set(toolCallId, timer);
}

function clearTimers(toolCallId: string): void {
	const timer = trailingTimers.get(toolCallId);
	if (timer) clearTimeout(timer);
	trailingTimers.delete(toolCallId);
	lastNotifyAt.delete(toolCallId);
	const tick = tickTimers.get(toolCallId);
	if (tick) clearInterval(tick);
	tickTimers.delete(toolCallId);
}

export function getBashProgress(toolCallId: string): BashProgress | undefined {
	return store.get(toolCallId);
}

export function startBashProgress(toolCallId: string, timeoutMs?: number): void {
	// A re-run with the same id shouldn't stack heartbeats.
	clearTimers(toolCallId);
	const snapshot: BashProgress = {
		output: "",
		totalLines: 0,
		totalBytes: 0,
		startTime: Date.now(),
		timeoutMs,
		done: false,
	};
	store.set(toolCallId, snapshot);
	emit(toolCallId, snapshot);

	// Heartbeat: re-emit the live snapshot every second so the card's elapsed
	// clock keeps moving even when the command produces no output. Cleared on
	// completion. unref() so a stray tick never keeps the process alive.
	const tick = setInterval(() => {
		const cur = store.get(toolCallId);
		if (!cur || cur.done) return;
		emit(toolCallId, cur);
	}, TICK_INTERVAL_MS);
	tick.unref?.();
	tickTimers.set(toolCallId, tick);
}

export function appendBashProgress(toolCallId: string, chunk: string): void {
	const cur = store.get(toolCallId);
	if (!cur) return;
	const combined = cur.output + chunk;
	const lines = combined.split("\n");
	const tail = lines.slice(-MAX_TAIL_LINES);
	const next: BashProgress = {
		...cur,
		output: tail.join("\n"),
		totalLines: cur.totalLines + (chunk.match(/\n/g)?.length ?? 0),
		totalBytes: cur.totalBytes + Buffer.byteLength(chunk),
	};
	store.set(toolCallId, next);
	notifyThrottled(toolCallId);
}

export function completeBashProgress(toolCallId: string): void {
	const cur = store.get(toolCallId);
	if (!cur) return;
	clearTimers(toolCallId);
	const next: BashProgress = { ...cur, done: true };
	store.set(toolCallId, next);
	emit(toolCallId, next); // force a final flush
}

export function clearBashProgress(toolCallId: string): void {
	if (!store.has(toolCallId)) return;
	clearTimers(toolCallId);
	store.delete(toolCallId);
	emit(toolCallId, undefined);
}

export function clearAllBashProgress(): void {
	const ids = [...store.keys()];
	for (const id of ids) {
		clearTimers(id);
	}
	store.clear();
	for (const id of ids) {
		emit(id, undefined);
	}
}

export function subscribeBashProgress(listener: Listener): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
