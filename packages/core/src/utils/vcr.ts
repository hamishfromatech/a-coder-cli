/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

/**
 * VCR (Video Cassette Recording) — records API calls and replays them
 * for deterministic, fast, offline tests.
 *
 * Usage:
 *   - Set `A_CODER_VCR_MODE=record` to record API calls
 *   - Set `A_CODER_VCR_MODE=replay` to replay from recordings
 *   - Set `A_CODER_VCR_DIR` to override the recordings directory (default: ~/.a-coder-cli/vcr/)
 */

export type VcrMode = 'record' | 'replay' | 'off';

interface VcrRecording {
  method: string;
  args: unknown;
  result: unknown;
  timestamp: string;
}

function getVcrDir(): string {
  return process.env.A_CODER_VCR_DIR || join(homedir(), '.a-coder-cli', 'vcr');
}

function getVcrMode(): VcrMode {
  const mode = process.env.A_CODER_VCR_MODE;
  if (mode === 'record') return 'record';
  if (mode === 'replay') return 'replay';
  return 'off';
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 100);
}

/**
 * Records a single API interaction to disk.
 */
export async function vcrRecord(
  cassetteName: string,
  method: string,
  args: unknown,
  result: unknown,
): Promise<void> {
  const mode = getVcrMode();
  if (mode !== 'record') return;

  try {
    const vcrDir = getVcrDir();
    await fs.mkdir(vcrDir, { recursive: true });

    const filename = sanitizeFilename(cassetteName) + '.json';
    const filepath = join(vcrDir, filename);

    const recording: VcrRecording = {
      method,
      args,
      result,
      timestamp: new Date().toISOString(),
    };

    await fs.writeFile(filepath, JSON.stringify(recording, null, 2));
  } catch (error) {
    // VCR recording should never break the application
    console.warn('[VCR] Failed to record:', error);
  }
}

/**
 * Replays a previously recorded API interaction.
 * Returns the recorded result or null if no recording exists.
 */
export async function vcrReplay(
  cassetteName: string,
  method: string,
): Promise<unknown | null> {
  const mode = getVcrMode();
  if (mode !== 'replay') return null;

  try {
    const vcrDir = getVcrDir();
    const filename = sanitizeFilename(cassetteName) + '.json';
    const filepath = join(vcrDir, filename);

    const content = await fs.readFile(filepath, 'utf-8');
    const recording = JSON.parse(content) as VcrRecording;

    if (recording.method !== method) {
      console.warn(
        `[VCR] Method mismatch for ${cassetteName}: expected ${recording.method}, got ${method}`,
      );
      return null;
    }

    return recording.result;
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return null; // No recording found — not an error
    }
    console.warn('[VCR] Failed to replay:', error);
    return null;
  }
}

/**
 * Wraps an async API function with VCR record/replay behavior.
 *
 * @param cassetteName Unique name for this API call (used as filename)
 * @param method Method name (for verification on replay)
 * @param args Arguments to record (for identification)
 * @param fn The actual API function to call (skipped on replay)
 * @returns The API result (either replayed or live)
 */
export async function withVcr<T>(
  cassetteName: string,
  method: string,
  args: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  const mode = getVcrMode();

  if (mode === 'replay') {
    const replayed = await vcrReplay(cassetteName, method);
    if (replayed !== null) {
      return replayed as T;
    }
    // No recording found — fall through to live call
    console.warn(`[VCR] No recording found for ${cassetteName}, falling back to live call`);
  }

  const result = await fn();

  if (mode === 'record') {
    await vcrRecord(cassetteName, method, args, result);
  }

  return result;
}

/**
 * Returns true if VCR is in any active mode.
 */
export function isVcrActive(): boolean {
  return getVcrMode() !== 'off';
}
