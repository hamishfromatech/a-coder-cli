/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { GEMINI_DIR } from './paths.js';

/**
 * Represents a heartbeat lock file
 */
export interface HeartbeatLock {
  pid: number;
  startedAt: string;
  lockFilePath: string;
}

/**
 * Acquires a lock for heartbeat mode to prevent concurrent executions.
 * Uses a .pid file in the .a-coder-cli directory.
 * @param targetDir The project root directory
 * @returns The lock object if acquired, null if another instance is running
 */
export function acquireHeartbeatLock(targetDir: string): HeartbeatLock | null {
  const lockDir = path.join(targetDir, GEMINI_DIR);
  const lockFilePath = path.join(lockDir, 'heartbeat.pid');

  // Ensure directory exists
  if (!fs.existsSync(lockDir)) {
    fs.mkdirSync(lockDir, { recursive: true });
  }

  // Check if lock exists and is still valid
  if (fs.existsSync(lockFilePath)) {
    try {
      const lockData = JSON.parse(fs.readFileSync(lockFilePath, 'utf8'));

      // Check if the process is still running
      if (lockData.pid && processPidExists(lockData.pid)) {
        return null; // Lock is held by another process
      }

      // Stale lock, remove it
      fs.unlinkSync(lockFilePath);
    } catch {
      // Invalid lock file, remove it
      try {
        fs.unlinkSync(lockFilePath);
      } catch {
        // Ignore if already removed
      }
    }
  }

  // Create new lock
  const lock: HeartbeatLock = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    lockFilePath,
  };

  fs.writeFileSync(lockFilePath, JSON.stringify(lock, null, 2), 'utf8');
  return lock;
}

/**
 * Releases the heartbeat lock
 * @param lock The lock to release
 */
export function releaseHeartbeatLock(lock: HeartbeatLock): void {
  try {
    if (fs.existsSync(lock.lockFilePath)) {
      const lockData = JSON.parse(fs.readFileSync(lock.lockFilePath, 'utf8'));
      // Only release if we own the lock
      if (lockData.pid === lock.pid) {
        fs.unlinkSync(lock.lockFilePath);
      }
    }
  } catch {
    // Ignore errors during cleanup
  }
}

/**
 * Check if a process with given PID exists
 * @param pid Process ID to check
 * @returns true if process exists, false otherwise
 */
function processPidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
