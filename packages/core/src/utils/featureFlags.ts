/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A single feature flag with optional gradual rollout percentage.
 */
export interface FeatureFlag {
  name: string;
  enabled: boolean;
  rolloutPercentage?: number;
}

/**
 * Input type accepted from configuration files.
 * Flags can be a simple boolean or an object with enabled/rolloutPercentage.
 */
export type FeatureFlagConfigInput = boolean | {
  enabled: boolean;
  rolloutPercentage?: number;
};

/**
 * Service for managing feature flags with support for gradual rollout.
 *
 * Usage:
 * ```ts
 * import { featureFlags } from './utils/featureFlags.js';
 *
 * if (featureFlags.isEnabled('myFeature')) {
 *   // ... new behaviour
 * }
 * ```
 */
export class FeatureFlagService {
  private flags: Map<string, FeatureFlag>;

  constructor(
    configFlags?: Record<string, FeatureFlagConfigInput>,
  ) {
    this.flags = new Map();

    if (configFlags) {
      for (const [name, value] of Object.entries(configFlags)) {
        if (typeof value === 'boolean') {
          this.flags.set(name, { name, enabled: value });
        } else {
          this.flags.set(name, {
            name,
            enabled: value.enabled,
            rolloutPercentage: value.rolloutPercentage,
          });
        }
      }
    }
  }

  /**
   * Checks whether a feature flag is enabled.
   *
   * If the flag has a `rolloutPercentage` and the simple `enabled` check is true,
   * a deterministic hash of the flag name is used to decide whether the flag is
   * active for this instance. This provides a stable per-flag rollout rather than
   * a random per-call decision.
   */
  isEnabled(flagName: string): boolean {
    const flag = this.flags.get(flagName);

    if (!flag) {
      return false;
    }

    if (!flag.enabled) {
      return false;
    }

    // If no rollout is configured, the enabled value is definitive.
    if (flag.rolloutPercentage === undefined) {
      return true;
    }

    // Deterministic rollout: hash the flag name into 0-99 and compare.
    const hash = this.simpleHash(flagName);
    return hash < flag.rolloutPercentage;
  }

  /** Enables a feature flag (creates it if it does not exist). */
  enable(flagName: string): void {
    const existing = this.flags.get(flagName);
    if (existing) {
      existing.enabled = true;
    } else {
      this.flags.set(flagName, { name: flagName, enabled: true });
    }
  }

  /** Disables a feature flag. */
  disable(flagName: string): void {
    const existing = this.flags.get(flagName);
    if (existing) {
      existing.enabled = false;
    }
  }

  /**
   * Sets the rollout percentage for a flag (0-100).
   * The flag is created if it does not already exist.
   */
  setRollout(flagName: string, percentage: number): void {
    const clamped = Math.max(0, Math.min(100, percentage));
    const existing = this.flags.get(flagName);
    if (existing) {
      existing.rolloutPercentage = clamped;
    } else {
      this.flags.set(flagName, {
        name: flagName,
        enabled: true,
        rolloutPercentage: clamped,
      });
    }
  }

  /** Returns a snapshot of all registered flags. */
  getFlags(): Record<string, { enabled: boolean; rolloutPercentage?: number }> {
    const result: Record<string, { enabled: boolean; rolloutPercentage?: number }> = {};
    for (const [name, flag] of this.flags) {
      result[name] = {
        enabled: flag.enabled,
        rolloutPercentage: flag.rolloutPercentage,
      };
    }
    return result;
  }

  /**
   * Initializes (or re-initializes) the service from a configuration source.
   * Existing flags are replaced; flags not present in `configFlags` are removed.
   */
  initializeFromConfig(configFlags?: Record<string, FeatureFlagConfigInput>): void {
    this.flags.clear();

    if (configFlags) {
      for (const [name, value] of Object.entries(configFlags)) {
        if (typeof value === 'boolean') {
          this.flags.set(name, { name, enabled: value });
        } else {
          this.flags.set(name, {
            name,
            enabled: value.enabled,
            rolloutPercentage: value.rolloutPercentage,
          });
        }
      }
    }
  }

  /**
   * Simple deterministic hash that maps a string to an integer in [0, 99].
   * Uses a djb2-style hash for speed and stability.
   */
  private simpleHash(str: string): number {
    let hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0x7fffffff;
    }
    return hash % 100;
  }
}

/** Singleton feature flag service instance. */
export const featureFlags: FeatureFlagService = new FeatureFlagService();
