/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { EventEmitter } from 'events';

export interface ContextMonitorConfig {
  warningThreshold: number;      // Default: 0.7 (70%)
  criticalThreshold: number;     // Default: 0.85 (85%)
  autoCompressThreshold: number;  // Default: 0.9 (90%)
}

export enum ContextEvent {
  WARNING = 'warning',       // Approaching limit
  CRITICAL = 'critical',     // Near limit, warn user
  AUTO_COMPRESS = 'auto_compress' // Trigger auto-compression
}

export interface ContextUsageInfo {
  event: ContextEvent;
  currentTokens: number;
  tokenLimit: number;
  percentage: number;
}

const DEFAULT_CONFIG: ContextMonitorConfig = {
  warningThreshold: 0.7,
  criticalThreshold: 0.85,
  autoCompressThreshold: 0.9,
};

export class ContextMonitor extends EventEmitter {
  constructor(private config: ContextMonitorConfig = DEFAULT_CONFIG) {
    super();
  }

  /**
   * Checks context usage against thresholds and returns appropriate event type.
   *
   * @param currentTokens - Current token count of the chat history
   * @param tokenLimit - Maximum token limit for the model
   * @returns ContextEvent or null if no threshold is exceeded
   */
  checkUsage(currentTokens: number, tokenLimit: number): ContextUsageInfo | null {
    const percentage = currentTokens / tokenLimit;

    // Check thresholds in order of severity (highest first)
    if (percentage >= this.config.autoCompressThreshold) {
      return {
        event: ContextEvent.AUTO_COMPRESS,
        currentTokens,
        tokenLimit,
        percentage,
      };
    }
    if (percentage >= this.config.criticalThreshold) {
      return {
        event: ContextEvent.CRITICAL,
        currentTokens,
        tokenLimit,
        percentage,
      };
    }
    if (percentage >= this.config.warningThreshold) {
      return {
        event: ContextEvent.WARNING,
        currentTokens,
        tokenLimit,
        percentage,
      };
    }

    return null;
  }

  /**
   * Gets the current monitor configuration
   */
  getConfig(): ContextMonitorConfig {
    return { ...this.config };
  }

  /**
   * Updates the monitor configuration
   */
  updateConfig(config: Partial<ContextMonitorConfig>): void {
    this.config = { ...this.config, ...config };
  }
}