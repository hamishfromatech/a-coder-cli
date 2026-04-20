/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Lightweight startup profiler that instruments key initialization steps.
 * Modeled after Claude Code's startupProfiler pattern.
 *
 * Enable via A_CODER_DEBUG_STARTUP=1 environment variable or
 * by calling enable() before the first checkpoint.
 *
 * Usage:
 * ```ts
 * import { startupProfiler } from './startupProfiler.js';
 * startupProfiler.checkpoint('tool-registry-start');
 * // ... do work ...
 * startupProfiler.checkpoint('tool-registry-done');
 * console.log(startupProfiler.getReport());
 * ```
 */

export class StartupProfiler {
  private checkpoints: Array<{ label: string; timestamp: number; deltaMs: number }> = [];
  private startTime: number;
  private enabled: boolean;

  constructor(enabled: boolean = false) {
    this.enabled = enabled;
    this.startTime = Date.now();
    this.checkpoints = [{ label: 'init', timestamp: this.startTime, deltaMs: 0 }];
  }

  /**
   * Records a startup checkpoint.
   * No-op when profiling is disabled.
   */
  checkpoint(label: string): void {
    if (!this.enabled) return;
    const now = Date.now();
    this.checkpoints.push({
      label,
      timestamp: now,
      deltaMs: now - this.startTime,
    });
  }

  /**
   * Returns a formatted report of all checkpoints.
   * Empty string when profiling is disabled.
   */
  getReport(): string {
    if (!this.enabled || this.checkpoints.length <= 1) return '';

    const lines = this.checkpoints.map(
      (c) => `[Startup] ${c.label}: +${c.deltaMs}ms`,
    );

    const totalMs = this.checkpoints[this.checkpoints.length - 1].deltaMs;
    lines.push(`[Startup] Total: ${totalMs}ms`);

    return lines.join('\n');
  }

  /**
   * Returns the raw checkpoint data for programmatic access.
   */
  getCheckpoints(): Array<{ label: string; timestamp: number; deltaMs: number }> {
    return [...this.checkpoints];
  }

  /**
   * Resets the profiler, clearing all checkpoints.
   */
  reset(): void {
    this.startTime = Date.now();
    this.checkpoints = [{ label: 'init', timestamp: this.startTime, deltaMs: 0 }];
  }
}

/**
 * Global startup profiler instance.
 * Enabled via A_CODER_DEBUG_STARTUP=1 environment variable.
 */
export const startupProfiler = new StartupProfiler(
  process.env.A_CODER_DEBUG_STARTUP === '1' || process.env.A_CODER_DEBUG_STARTUP === 'true',
);