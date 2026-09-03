/**
 * Generic in-process store with subscribe/notify.
 *
 * Mirrors easy-agent's global store pattern (todoStore, bashProgressStore,
 * subAgentProgressStore): a module-level Map keyed by id, with listeners that
 * fire on every mutation. The UI subscribes to drive re-renders; tools
 * publish updates as side-channels (while a tool is blocked on `await`,
 * there's no path to yield events back into the agent loop's generator).
 *
 * This is a V1 in-process store — lost on exit. For persistent state, use
 * the disk-backed task-store.ts instead.
 */

export interface Store<T> {
	/** Get the current value for an id, or undefined. */
	get(id: string): T | undefined;
	/** Set the value for an id and notify all subscribers. */
	set(id: string, value: T): void;
	/**
	 * Set with coalesced notifications (easy-agent's bashProgressStore pattern):
	 * the first call in a window notifies immediately (leading edge), later calls
	 * only update the value, and a trailing timer flushes the latest value once
	 * the window closes. A chatty producer (a background process emitting output
	 * in bursts) then drives subscribers at ~throttleHz instead of per chunk,
	 * while completion events via {@link set} stay immediate.
	 */
	setThrottled(id: string, value: T): void;
	/** Delete an id and notify subscribers (they receive undefined). */
	delete(id: string): void;
	/** Clear all entries and notify subscribers. */
	clear(): void;
	/** Subscribe to all changes. The listener receives (id, value). Returns an unsubscribe function. */
	subscribe(listener: StoreListener<T>): () => void;
	/** Snapshot all entries — useful for tests and debug. */
	entries(): Array<[string, T]>;
}

export type StoreListener<T> = (id: string, value: T | undefined) => void;

export function createStore<T>(options?: { throttleMs?: number }): Store<T> {
	const map = new Map<string, T>();
	const listeners = new Set<StoreListener<T>>();
	const throttleMs = options?.throttleMs ?? 0;
	const pendingThrottled = new Set<string>();
	let throttleTimer: ReturnType<typeof setTimeout> | undefined;

	const notify = (id: string, value: T | undefined): void => {
		for (const listener of listeners) {
			try {
				listener(id, value);
			} catch {
				// Never let a subscriber break a mutation.
			}
		}
	};

	const flushThrottled = (): void => {
		throttleTimer = undefined;
		const ids = [...pendingThrottled];
		pendingThrottled.clear();
		for (const id of ids) {
			const value = map.get(id);
			if (value !== undefined) notify(id, value);
		}
	};

	return {
		get(id) {
			return map.get(id);
		},
		set(id, value) {
			map.set(id, value);
			pendingThrottled.delete(id);
			notify(id, value);
		},
		setThrottled(id, value) {
			map.set(id, value);
			if (throttleMs <= 0) {
				notify(id, value);
				return;
			}
			if (!throttleTimer) {
				// Leading edge: notify now, open the coalescing window.
				notify(id, value);
				throttleTimer = setTimeout(flushThrottled, throttleMs);
			} else {
				pendingThrottled.add(id);
			}
		},
		delete(id) {
			if (map.delete(id)) {
				pendingThrottled.delete(id);
				notify(id, undefined);
			}
		},
		clear() {
			if (map.size === 0) return;
			const ids = [...map.keys()];
			map.clear();
			pendingThrottled.clear();
			for (const id of ids) {
				notify(id, undefined);
			}
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		entries() {
			return [...map.entries()];
		},
	};
}
