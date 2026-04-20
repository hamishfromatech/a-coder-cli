/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'crypto';

/**
 * Reason why a prompt cache break occurred.
 * Modeled after Claude Code's promptCacheBreakDetection diagnostics.
 */
export interface CacheBreakReason {
  systemPromptChanged: boolean;
  toolDeclarationsChanged: boolean;
  modelChanged: boolean;
  previousModel: string | null;
  currentModel: string;
}

/**
 * Tracks prompt cache state to detect when the system prompt or tool
 * declarations change between requests. This helps identify cache-break
 * events that cause redundant API processing.
 *
 * The Gemini API handles actual prompt caching server-side, but this
 * tracker provides visibility into cache hit/miss patterns and helps
 * optimize prompt stability.
 *
 * Enhanced with diagnostic info (model changes, break reasons) matching
 * Claude Code's promptCacheBreakDetection pattern.
 */
export class PromptCacheTracker {
  private lastSystemPromptHash: string | null = null;
  private lastToolDeclarationsHash: string | null = null;
  private lastModel: string | null = null;
  private cacheHits = 0;
  private cacheMisses = 0;
  private breakReasons: CacheBreakReason[] = [];

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
   * Checks both system prompt, tool declarations, and model in one call.
   * Returns diagnostic info including break reason when a cache miss occurs.
   *
   * @returns Object with individual cache hit status, overall status, and optional break reason
   */
  checkAll(systemPrompt: string, toolDeclarations: unknown[], model: string): {
    systemPromptHit: boolean;
    toolDeclarationsHit: boolean;
    modelHit: boolean;
    overallHit: boolean;
    breakReason?: CacheBreakReason;
  } {
    const systemPromptHit = this.checkSystemPrompt(systemPrompt);
    const toolDeclarationsHit = this.checkToolDeclarations(toolDeclarations);

    const modelChanged = this.lastModel !== null && this.lastModel !== model;
    this.lastModel = model;

    const overallHit = systemPromptHit && toolDeclarationsHit && !modelChanged;

    if (!overallHit) {
      const reason: CacheBreakReason = {
        systemPromptChanged: !systemPromptHit,
        toolDeclarationsChanged: !toolDeclarationsHit,
        modelChanged,
        previousModel: this.lastModel,
        currentModel: model,
      };
      this.breakReasons.push(reason);
      // Cap break reasons to prevent unbounded memory growth
      if (this.breakReasons.length > 10) {
        this.breakReasons.shift();
      }
      return {
        systemPromptHit,
        toolDeclarationsHit,
        modelHit: !modelChanged,
        overallHit: false,
        breakReason: reason,
      };
    }
    return { systemPromptHit, toolDeclarationsHit, modelHit: true, overallHit: true };
  }

  /**
   * Gets cache statistics.
   */
  getStats(): { hits: number; misses: number; hitRate: number; breakCount: number } {
    const total = this.cacheHits + this.cacheMisses;
    return {
      hits: this.cacheHits,
      misses: this.cacheMisses,
      hitRate: total > 0 ? this.cacheHits / total : 0,
      breakCount: this.breakReasons.length,
    };
  }

  /**
   * Gets a diagnostic report of cache break events for the session.
   * Useful for debugging prompt cache stability issues.
   */
  getDiagnosticReport(): string {
    const stats = this.getStats();
    const lines: string[] = [
      `[PromptCache] Session stats: ${stats.hits} hits, ${stats.misses} misses (${(stats.hitRate * 100).toFixed(1)}% hit rate), ${stats.breakCount} breaks`,
    ];

    if (this.breakReasons.length > 0) {
      lines.push('[PromptCache] Break reasons:');
      for (const reason of this.breakReasons) {
        const causes: string[] = [];
        if (reason.systemPromptChanged) causes.push('system prompt changed');
        if (reason.toolDeclarationsChanged) causes.push('tool declarations changed');
        if (reason.modelChanged) causes.push(`model changed: ${reason.previousModel} → ${reason.currentModel}`);
        lines.push(`  - ${causes.join(', ')}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Resets all tracking state.
   */
  reset(): void {
    this.lastSystemPromptHash = null;
    this.lastToolDeclarationsHash = null;
    this.lastModel = null;
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.breakReasons = [];
  }
}