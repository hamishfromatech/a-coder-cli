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

export function createStore<T>(): Store<T> {
	const map = new Map<string, T>();
	const listeners = new Set<StoreListener<T>>();

	const notify = (id: string, value: T | undefined): void => {
		for (const listener of listeners) {
			try {
				listener(id, value);
			} catch {
				// Never let a subscriber break a mutation.
			}
		}
	};

	return {
		get(id) {
			return map.get(id);
		},
		set(id, value) {
			map.set(id, value);
			notify(id, value);
		},
		delete(id) {
			if (map.delete(id)) {
				notify(id, undefined);
			}
		},
		clear() {
			if (map.size === 0) return;
			const ids = [...map.keys()];
			map.clear();
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
