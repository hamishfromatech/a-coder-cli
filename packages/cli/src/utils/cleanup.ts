/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { getProjectTempDir } from '@a-coder/core';

const cleanupFunctions: Array<() => void> = [];
const asyncCleanupFunctions: Array<() => Promise<void>> = [];
let _isShuttingDown = false;
let _shutdownReason: string | null = null;

export function registerCleanup(fn: () => void) {
  cleanupFunctions.push(fn);
}

export function registerAsyncCleanup(fn: () => Promise<void>) {
  asyncCleanupFunctions.push(fn);
}

export function isShuttingDown(): boolean {
  return _isShuttingDown;
}

export function getShutdownReason(): string | null {
  return _shutdownReason;
}

/**
 * Runs all synchronous cleanup functions.
 */
export function runExitCleanup() {
  for (const fn of cleanupFunctions) {
    try {
      fn();
    } catch (_) {
      // Ignore errors during cleanup.
    }
  }
  cleanupFunctions.length = 0; // Clear the array
}

/**
 * Runs all async cleanup functions with a timeout.
 * Falls back to process.exit() if cleanup takes too long.
 *
 * @param timeoutMs Maximum time to wait for async cleanups (default: 5000ms)
 * @returns Promise that resolves when all cleanups complete
 */
export async function runAsyncCleanup(timeoutMs: number = 5000): Promise<void> {
  if (asyncCleanupFunctions.length === 0) return;

  const cleanupPromises = asyncCleanupFunctions.map(async (fn) => {
    try {
      await fn();
    } catch (_) {
      // Ignore individual cleanup errors.
    }
  });

  const timeoutPromise = new Promise<void>((resolve) =>
    setTimeout(resolve, timeoutMs),
  );

  await Promise.race([Promise.all(cleanupPromises), timeoutPromise]);
  asyncCleanupFunctions.length = 0;
}

/**
 * Requests a graceful shutdown. Sets the shutting down flag, runs async
 * cleanups with a timeout, then runs sync cleanups, then exits.
 */
export async function requestShutdown(reason: string): Promise<void> {
  if (_isShuttingDown) {
    // Second call — force exit immediately
    process.exit(1);
  }

  _isShuttingDown = true;
  _shutdownReason = reason;

  try {
    await runAsyncCleanup(5000);
  } catch (_) {
    // Ignore cleanup errors.
  }

  runExitCleanup();
  process.exit(0);
}

/**
 * Sets up SIGTERM and SIGINT handlers for graceful shutdown.
 * SIGINT (Ctrl+C) uses double-press detection: first press starts
 * graceful shutdown, second press within 3s forces exit.
 *
 * @param onFirstSignal Optional callback invoked on the first signal
 */
export function setupGracefulShutdown(onFirstSignal?: () => void): void {
  let sigintTimestamp = 0;

  process.on('SIGTERM', async () => {
    await requestShutdown('SIGTERM');
  });

  process.on('SIGINT', async () => {
    const now = Date.now();

    if (now - sigintTimestamp < 3000) {
      // Double press within 3 seconds — force exit
      process.exit(1);
    }

    sigintTimestamp = now;

    if (onFirstSignal) {
      onFirstSignal();
    }

    // Start graceful shutdown after a brief delay to allow
    // the first-press handler to run
    setTimeout(async () => {
      await requestShutdown('SIGINT');
    }, 100);
  });
}

export async function cleanupCheckpoints() {
  const tempDir = getProjectTempDir(process.cwd());
  const checkpointsDir = join(tempDir, 'checkpoints');
  try {
    await fs.rm(checkpointsDir, { recursive: true, force: true });
  } catch {
    // Ignore errors if the directory doesn't exist or fails to delete.
  }
}
