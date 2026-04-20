/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as path from 'node:path';

/**
 * LRU file content cache with mtimeMs-based validation.
 *
 * Modeled after Claude Code's FileStateCache pattern. Caches file contents
 * to avoid redundant disk reads, with automatic staleness detection via
 * modification time comparison and size-based eviction.
 *
 * - Cache hit: same path + same mtimeMs → return cached content
 * - Cache miss: different path or mtimeMs changed → re-read from disk
 * - Eviction: LRU by insertion order, evicts oldest when at capacity
 */
export class FileContentCache {
  private cache: Map<
    string,
    { content: string; mtimeMs: number; size: number }
  > = new Map();
  private totalSize: number = 0;

  /**
   * @param maxSizeBytes Maximum total cached content in bytes (default: 25MB)
   * @param maxEntries Maximum number of cached entries (default: 100)
   */
  constructor(
    private readonly maxSizeBytes: number = 25 * 1024 * 1024,
    private readonly maxEntries: number = 100,
  ) {}

  /**
   * Gets cached file content if the file hasn't been modified since it was cached.
   * Promotes the entry to most-recently-used on hit.
   *
   * @param normalizedPath The resolved absolute path (use path.resolve())
   * @param currentMtimeMs The file's current modification time in milliseconds
   * @returns The cached content string, or undefined if not cached or stale
   */
  get(normalizedPath: string, currentMtimeMs: number): string | undefined {
    const entry = this.cache.get(normalizedPath);

    if (entry && entry.mtimeMs === currentMtimeMs) {
      // Cache hit — promote to MRU by delete + re-insert
      this.cache.delete(normalizedPath);
      this.cache.set(normalizedPath, entry);
      return entry.content;
    }

    if (entry) {
      // Stale entry — remove and account for size
      this.totalSize -= entry.size;
      this.cache.delete(normalizedPath);
    }

    return undefined;
  }

  /**
   * Stores file content in the cache. Evicts LRU entries if at capacity.
   *
   * @param normalizedPath The resolved absolute path
   * @param content The file content to cache
   * @param mtimeMs The file's modification time in milliseconds
   * @param size The byte size of the content
   */
  set(
    normalizedPath: string,
    content: string,
    mtimeMs: number,
    size: number,
  ): void {
    // Remove existing entry if present (update case)
    const existing = this.cache.get(normalizedPath);
    if (existing) {
      this.totalSize -= existing.size;
      this.cache.delete(normalizedPath);
    }

    // Evict LRU entries if at capacity (size or count)
    while (
      (this.totalSize + size > this.maxSizeBytes ||
        this.cache.size >= this.maxEntries) &&
      this.cache.size > 0
    ) {
      const firstKey = this.cache.keys().next().value!;
      const evicted = this.cache.get(firstKey)!;
      this.totalSize -= evicted.size;
      this.cache.delete(firstKey);
    }

    this.cache.set(normalizedPath, { content, mtimeMs, size });
    this.totalSize += size;
  }

  /**
   * Invalidates a single file's cache entry.
   * Call this after writing or editing a file.
   */
  invalidate(normalizedPath: string): void {
    const entry = this.cache.get(normalizedPath);
    if (entry) {
      this.totalSize -= entry.size;
      this.cache.delete(normalizedPath);
    }
  }

  /**
   * Clears the entire cache.
   */
  clear(): void {
    this.cache.clear();
    this.totalSize = 0;
  }

  /**
   * Returns cache statistics for debugging.
   */
  getStats(): { entries: number; totalSizeBytes: number; maxEntries: number; maxSizeBytes: number } {
    return {
      entries: this.cache.size,
      totalSizeBytes: this.totalSize,
      maxEntries: this.maxEntries,
      maxSizeBytes: this.maxSizeBytes,
    };
  }
}

/**
 * Normalizes a file path for use as a cache key.
 * Resolves relative paths and normalizes separators.
 */
export function normalizePathForCache(filePath: string): string {
  return path.resolve(filePath);
}