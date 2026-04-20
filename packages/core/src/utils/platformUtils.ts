/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as process from 'node:process';

/**
 * Platform detection utilities for cross-platform performance optimizations.
 * Modeled after Claude Code's cross-platform handling patterns.
 */

let wslDetectionCache: boolean | null = null;

/**
 * Detects whether the current environment is Windows Subsystem for Linux (WSL).
 * WSL has 2-3x filesystem performance penalty, so we adjust timeouts accordingly.
 *
 * Caches the result for the process lifetime.
 */
export function isWSL(): boolean {
  if (wslDetectionCache !== null) return wslDetectionCache;

  if (process.platform !== 'linux') {
    wslDetectionCache = false;
    return false;
  }

  try {
    const release = fs.readFileSync('/proc/version', 'utf8');
    const isWsl =
      release.toLowerCase().includes('microsoft') ||
      release.toLowerCase().includes('wsl');
    wslDetectionCache = isWsl;
    return isWsl;
  } catch {
    wslDetectionCache = false;
    return false;
  }
}

/**
 * Returns true if running on macOS.
 */
export function isMacOS(): boolean {
  return process.platform === 'darwin';
}

/**
 * Returns true if running on Windows.
 */
export function isWindows(): boolean {
  return process.platform === 'win32';
}

/**
 * Returns the appropriate timeout multiplier for the current platform.
 * WSL gets 2x longer timeouts due to filesystem performance penalty.
 */
export function getPlatformTimeoutMultiplier(): number {
  return isWSL() ? 2 : 1;
}

/**
 * Returns the platform name for display purposes.
 */
export function getPlatformName(): string {
  if (isWSL()) return 'wsl';
  if (isMacOS()) return 'macos';
  if (isWindows()) return 'windows';
  return process.platform;
}

/**
 * Recommended timeouts for tool execution by platform.
 * WSL gets longer timeouts due to 2-3x filesystem performance penalty.
 */
export const PLATFORM_TIMEOUTS = {
  /** Default tool execution timeout in ms */
  toolExecution: isWSL() ? 60_000 : 30_000,
  /** Default ripgrep-style search timeout in ms */
  search: isWSL() ? 60_000 : 30_000,
  /** Default API connection timeout in ms */
  apiConnection: isWSL() ? 30_000 : 15_000,
} as const;