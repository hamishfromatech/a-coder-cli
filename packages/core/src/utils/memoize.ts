/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Memoization utilities for caching function results.
 *
 * Modeled after Claude Code's memoization patterns for prompt cache stability
 * and performance optimization.
 */

/**
 * Creates a memoized version of a function that caches results with a TTL
 * (time-to-live). Supports stale-while-revalidate: if a cached value is
 * within the TTL, it's returned immediately. If it's stale (past TTL),
 * the stale value is still returned synchronously while a background
 * refresh is kicked off.
 *
 * @param fn The function to memoize
 * @param ttlMs Time-to-live in milliseconds (default: 5 minutes)
 * @param keyFn Optional function to generate cache keys from arguments
 * @returns A memoized version of fn
 */
export function memoizeWithTTL<T extends (...args: any[]) => any>(
  fn: T,
  ttlMs: number = 5 * 60 * 1000,
  keyFn: (...args: Parameters<T>) => string = (...args) =>
    JSON.stringify(args),
): T {
  const cache = new Map<
    string,
    { value: ReturnType<T>; expiry: number; refreshing?: boolean }
  >();

  return ((...args: Parameters<T>): ReturnType<T> => {
    const key = keyFn(...args);
    const now = Date.now();
    const entry = cache.get(key);

    if (entry && now < entry.expiry) {
      // Cache hit — value is still fresh
      return entry.value;
    }

    if (entry && !entry.refreshing) {
      // Stale-while-revalidate: return stale value, kick off refresh
      entry.refreshing = true;
      Promise.resolve()
        .then(() => fn(...args))
        .then((value: ReturnType<T>) => {
          entry.value = value;
          entry.expiry = now + ttlMs;
          entry.refreshing = undefined;
        })
        .catch(() => {
          // Refresh failed — keep stale value, try again next call
          entry.refreshing = undefined;
        });
      return entry.value;
    }

    // Cache miss (no entry or refreshing in progress and past TTL)
    const value = fn(...args);
    cache.set(key, { value, expiry: now + ttlMs });
    return value;
  }) as T;
}

/**
 * Creates a memoized version of a function that caches results in an LRU
 * (Least Recently Used) cache. When the cache exceeds maxSize, the oldest
 * entry is evicted.
 *
 * @param fn The function to memoize
 * @param maxSize Maximum number of entries (default: 100)
 * @param keyFn Optional function to generate cache keys from arguments
 * @returns A memoized version of fn
 */
export function memoizeWithLRU<T extends (...args: any[]) => any>(
  fn: T,
  maxSize: number = 100,
  keyFn: (...args: Parameters<T>) => string = (...args) =>
    JSON.stringify(args),
): T {
  const cache = new Map<string, { value: ReturnType<T> }>();

  return ((...args: Parameters<T>): ReturnType<T> => {
    const key = keyFn(...args);
    const entry = cache.get(key);

    if (entry) {
      // Promote to MRU by delete + re-insert
      cache.delete(key);
      cache.set(key, entry);
      return entry.value;
    }

    const value = fn(...args);

    // Evict LRU entry if at capacity
    if (cache.size >= maxSize) {
      const firstKey = cache.keys().next().value;
      if (firstKey !== undefined) {
        cache.delete(firstKey);
      }
    }

    cache.set(key, { value });
    return value;
  }) as T;
}

/**
 * Simple synchronous memoization that caches the result forever
 * (or until explicitly reset). Useful for values that are computed once
 * and never change within a session.
 *
 * @param fn The function to memoize
 * @returns An object with `get()` to retrieve the cached value and `reset()` to clear the cache
 */
export function memoizeOnce<T>(fn: () => T): {
  get: () => T;
  reset: () => void;
} {
  let cached: T | undefined;
  let computed = false;

  return {
    get(): T {
      if (!computed) {
        cached = fn();
        computed = true;
      }
      return cached as T;
    },
    reset(): void {
      cached = undefined;
      computed = false;
    },
  };
}