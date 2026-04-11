/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'crypto';

/**
 * Tracks prompt cache state to detect when the system prompt or tool
 * declarations change between requests. This helps identify cache-break
 * events that cause redundant API processing.
 *
 * The Gemini API handles actual prompt caching server-side, but this
 * tracker provides visibility into cache hit/miss patterns and helps
 * optimize prompt stability.
 */
export class PromptCacheTracker {
  private lastSystemPromptHash: string | null = null;
  private lastToolDeclarationsHash: string | null = null;
  private cacheHits = 0;
  private cacheMisses = 0;

  /**
   * Computes a stable hash of the system prompt content.
   */
  hashSystemPrompt(systemPrompt: string): string {
    return createHash('sha256').update(systemPrompt).digest('hex').slice(0, 16);
  }

  /**
   * Computes a stable hash of tool declarations.
   * Uses JSON.stringify on the sorted tool names and their schema signatures.
   */
  hashToolDeclarations(toolDeclarations: unknown[]): string {
    // Extract a stable representation: tool name + parameter hash
    const signatures = toolDeclarations
      .map((decl: any) => {
        const name = decl?.name ?? decl?.functionDeclarations?.[0]?.name ?? 'unknown';
        const params = JSON.stringify(decl?.parameters ?? decl?.functionDeclarations?.[0]?.parameters ?? {});
        return `${name}:${createHash('sha256').update(params).digest('hex').slice(0, 8)}`;
      })
      .sort();
    return createHash('sha256').update(signatures.join(',')).digest('hex').slice(0, 16);
  }

  /**
   * Checks if the system prompt has changed since the last check.
   * Updates the internal hash and tracks cache hit/miss.
   *
   * @returns true if the system prompt is unchanged (cache hit), false if changed (cache miss)
   */
  checkSystemPrompt(systemPrompt: string): boolean {
    const hash = this.hashSystemPrompt(systemPrompt);
    if (this.lastSystemPromptHash === null) {
      this.lastSystemPromptHash = hash;
      this.cacheMisses++;
      return false;
    }

    if (this.lastSystemPromptHash === hash) {
      this.cacheHits++;
      return true;
    }

    this.lastSystemPromptHash = hash;
    this.cacheMisses++;
    return false;
  }

  /**
   * Checks if tool declarations have changed since the last check.
   * Updates the internal hash and tracks cache hit/miss.
   *
   * @returns true if declarations are unchanged (cache hit), false if changed (cache miss)
   */
  checkToolDeclarations(toolDeclarations: unknown[]): boolean {
    const hash = this.hashToolDeclarations(toolDeclarations);
    if (this.lastToolDeclarationsHash === null) {
      this.lastToolDeclarationsHash = hash;
      this.cacheMisses++;
      return false;
    }

    if (this.lastToolDeclarationsHash === hash) {
      this.cacheHits++;
      return true;
    }

    this.lastToolDeclarationsHash = hash;
    this.cacheMisses++;
    return false;
  }

  /**
   * Checks both system prompt and tool declarations in one call.
   *
   * @returns Object with individual cache hit status and overall status
   */
  checkAll(systemPrompt: string, toolDeclarations: unknown[]): {
    systemPromptHit: boolean;
    toolDeclarationsHit: boolean;
    overallHit: boolean;
  } {
    const systemPromptHit = this.checkSystemPrompt(systemPrompt);
    const toolDeclarationsHit = this.checkToolDeclarations(toolDeclarations);
    return {
      systemPromptHit,
      toolDeclarationsHit,
      overallHit: systemPromptHit && toolDeclarationsHit,
    };
  }

  /**
   * Gets cache statistics.
   */
  getStats(): { hits: number; misses: number; hitRate: number } {
    const total = this.cacheHits + this.cacheMisses;
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: total > 0 ? this.cacheHits / total : 0,
    };
  }

  /**
   * Resets all tracking state.
   */
  reset(): void {
    this.lastSystemPromptHash = null;
    this.lastToolDeclarationsHash = null;
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }
}
