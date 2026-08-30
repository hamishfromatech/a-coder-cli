/**
 * Keyed async mutex — serializes async critical sections per string key
 * (typically a file path) while letting different keys run concurrently.
 * Used for read-modify-write sequences on shared on-disk state (team files,
 * teammates' mailboxes) so interleaved writers cannot drop each other's
 * updates. In-process only: pi-mono teammates run in the same process, which
 * is easy-agent's proper-lockfile design reduced to the single-process case.
 */
export async function withKeyedLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
	const previous = (locks.get(key) ?? Promise.resolve()) as Promise<unknown>;
	const next = previous.then(fn, fn);
	// Store the caught chain so a rejected op never poisons later writers.
	const tail = next.catch(() => undefined);
	locks.set(key, tail);
	try {
		return await next;
	} finally {
		if (locks.get(key) === tail) locks.delete(key);
	}
}

const locks = new Map<string, Promise<unknown>>();
