/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import stringWidth from 'string-width';

/**
 * Caches stringWidth() results to avoid re-measuring the same strings
 * across renders. During streaming text, completed lines are immutable —
 * caching their widths avoids hundreds of redundant stringWidth calls
 * per frame.
 *
 * Uses a simple full-clear eviction strategy (matching Claude Code's
 * approach): when the cache exceeds MAX_CACHE_SIZE, all entries are
 * discarded. This avoids the overhead of LRU tracking and works well
 * because the working set naturally shifts during streaming.
 */
export class LineWidthCache {
  private cache = new Map<string, number>();
  private hitCount = 0;
  private missCount = 0;

  constructor(private readonly maxSize = 4096) {}

  /**
   * Gets the cached width for a string, or computes and caches it.
   * This is the primary method to use — it transparently handles
   * cache misses and evictions.
   */
  getOrCompute(text: string): number {
    const cached = this.cache.get(text);
    if (cached !== undefined) {
      this.hitCount++;
      return cached;
    }

    this.missCount++;
    const width = stringWidth(text);

    if (this.cache.size >= this.maxSize) {
      this.cache.clear();
    }
    this.cache.set(text, width);

    return width;
  }

  /**
   * Gets a cached width if present, without computing on miss.
   * Returns undefined if not in cache.
   */
  get(text: string): number | undefined {
    return this.cache.get(text);
  }

  /**
   * Sets a width for a string directly (useful if you've already
   * computed the width and want to populate the cache).
   */
  set(text: string, width: number): void {
    if (this.cache.size >= this.maxSize) {
      this.cache.clear();
    }
    this.cache.set(text, width);
  }

  /**
   * Checks if a string is in the cache.
   */
  has(text: string): boolean {
    return this.cache.has(text);
  }

  /**
   * Clears all cached entries.
   */
  clear(): void {
    this.cache.clear();
    this.hitCount = 0;
    this.missCount = 0;
  }

  /**
   * Returns cache statistics.
   */
  getStats(): { size: number; hits: number; misses: number; hitRate: number } {
    const total = this.hitCount + this.missCount;
    return {
      size: this.cache.size,
      hits: this.hitCount,
      misses: this.missCount,
      hitRate: total > 0 ? this.hitCount / total : 0,
    };
  }
}

/**
 * Module-level singleton for use across the application.
 * All stringWidth consumers should use this instead of calling
 * stringWidth directly, to benefit from cross-component caching.
 */
export const lineWidthCache = new LineWidthCache();

/**
 * Drop-in replacement for stringWidth that uses the global cache.
 * Use this wherever you would normally call `stringWidth(text)`.
 */
export function cachedStringWidth(text: string): number {
  return lineWidthCache.getOrCompute(text);
}