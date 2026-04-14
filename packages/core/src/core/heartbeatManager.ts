/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'node:child_process';
import { Config } from '../config/config.js';
import { HeartbeatLock, acquireHeartbeatLock, releaseHeartbeatLock } from '../utils/heartbeatLock.js';
import { GEMINI_DIR } from '../utils/paths.js';

export interface HeartbeatConfig {
  intervalMinutes: number;
  maxIterations?: number;
}

export interface HeartbeatStatus {
  lastRun: string | null;
  nextRun: string | null;
  status: 'idle' | 'running' | 'completed' | 'error';
  currentTask: string | null;
}

/**
 * Gets the path to the heartbeat.md file for a given target directory
 */
export function getHeartbeatPath(targetDir: string): string {
  return path.join(targetDir, GEMINI_DIR, 'heartbeat.md');
}

/**
 * Gets the path to the plan.md file for a given target directory
 */
export function getPlanPath(targetDir: string): string {
  return path.join(targetDir, GEMINI_DIR, 'plan.md');
}

/**
 * Reads the interval from heartbeat.md if present
 * @param heartbeatPath Path to heartbeat.md
 * @returns Interval in minutes, or null if not found
 */
export function readHeartbeatInterval(heartbeatPath: string): number | null {
  if (!fs.existsSync(heartbeatPath)) return null;

  const content = fs.readFileSync(heartbeatPath, 'utf8');
  const match = content.match(/^Interval:\s*(\d+)/m);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Manages heartbeat mode scheduling.
 * Spawns a CLI process at each interval to work autonomously on the project.
 */
export class HeartbeatManager {
  private config: Config;
  private lock: HeartbeatLock | null = null;
  private intervalId: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;
  private iterationCount: number = 0;
  private maxIterations: number;
  private intervalMs: number;
  private heartbeatPath: string;
  private planPath: string;
  private cliPath: string;

  constructor(config: Config, heartbeatConfig?: Partial<HeartbeatConfig>) {
    this.config = config;
    this.intervalMs = (heartbeatConfig?.intervalMinutes ?? 10) * 60 * 1000;
    this.maxIterations = heartbeatConfig?.maxIterations ?? -1; // -1 = infinite
    this.heartbeatPath = getHeartbeatPath(config.getTargetDir());
    this.planPath = getPlanPath(config.getTargetDir());
    // Use 'a-coder-cli' command which should be available in PATH after global install
    this.cliPath = 'a-coder-cli';
  }

  /**
   * Starts the heartbeat scheduler.
   * Returns false if lock cannot be acquired (another instance is running).
   */
  start(): boolean {
    this.lock = acquireHeartbeatLock(this.config.getTargetDir());
    if (!this.lock) {
      console.log('[Heartbeat] Another instance is already running. Exiting.');
      return false;
    }

    console.log(`[Heartbeat] Starting with ${this.intervalMs / 60000} minute interval.`);
    this.isRunning = true;

    // Handle process termination
    const cleanup = () => this.stop();
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // Run immediately, then schedule
    this.runHeartbeatCycle().catch((err) => {
      console.error('[Heartbeat] Error during initial cycle:', err);
    });

    // Schedule subsequent runs
    this.scheduleNextRun();

    return true;
  }

  /**
   * Stops the heartbeat scheduler and releases the lock.
   */
  stop(): void {
    console.log('[Heartbeat] Stopping...');
    this.isRunning = false;

    if (this.intervalId) {
      clearTimeout(this.intervalId);
      this.intervalId = null;
    }

    if (this.lock) {
      releaseHeartbeatLock(this.lock);
      this.lock = null;
    }
  }

  private scheduleNextRun(): void {
    if (!this.isRunning) return;

    this.intervalId = setTimeout(() => {
      this.runHeartbeatCycle().catch((err) => {
        console.error('[Heartbeat] Error during cycle:', err);
      });
      this.scheduleNextRun();
    }, this.intervalMs);

    // Update heartbeat.md with next run time
    const nextRun = new Date(Date.now() + this.intervalMs).toISOString();
    this.updateHeartbeatStatus({ nextRun }).catch((err) => {
      console.error('[Heartbeat] Error updating next run time:', err);
    });
  }

  private async runHeartbeatCycle(): Promise<void> {
    if (!this.isRunning) return;

    this.iterationCount++;
    console.log(`[Heartbeat] Starting cycle ${this.iterationCount} at ${new Date().toISOString()}`);

    // Update status to running
    await this.updateHeartbeatStatus({
      status: 'running',
      lastRun: new Date().toISOString(),
    });

    try {
      // Spawn CLI to work autonomously
      await this.runCliCycle();

      console.log(`[Heartbeat] Cycle ${this.iterationCount} completed successfully.`);

    } catch (error) {
      console.error('[Heartbeat] Error during cycle:', error);
      await this.updateHeartbeatStatus({ status: 'error' });
    }

    // Check max iterations
    if (this.maxIterations > 0 && this.iterationCount >= this.maxIterations) {
      console.log('[Heartbeat] Max iterations reached. Stopping.');
      this.stop();
    }
  }

  /**
   * Run a single CLI process for this heartbeat cycle.
   * The CLI will read plan.md and heartbeat.md for context and use exit_heartbeat when done.
   */
  private async runCliCycle(): Promise<void> {
    const prompt = `You are in heartbeat mode — an autonomous building cycle.

1. Read .a-coder-cli/plan.md for the overall project plan and architecture.
2. Read .a-coder-cli/heartbeat.md for current progress and what to work on next.

heartbeat.md is the source of truth for project progress. Based on what you find there, actively work on the next thing that needs to be done. This means writing code, fixing bugs, implementing features — real building work using your tools (edit, write_file, shell, etc.).

Do NOT just read the files and stop. You must take action and make progress on the project.

When you have made meaningful progress and completed your work for this cycle, update heartbeat.md to reflect what you did and what's next, then call the exit_heartbeat tool to return control to the heartbeat scheduler. It will wake up again at the next interval to continue.`;

    console.log(`[Heartbeat] Spawning CLI for cycle ${this.iterationCount}...`);

    return new Promise((resolve, reject) => {
      const child = spawn(this.cliPath, ['--prompt', prompt, '--yolo'], {
        cwd: this.config.getTargetDir(),
        stdio: 'inherit',
        env: {
          ...process.env,
          HEARTBEAT_CYCLE_ID: String(this.iterationCount),
        },
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`CLI process exited with code ${code}`));
        }
      });

      child.on('error', (err) => {
        reject(err);
      });
    });
  }

  private async updateHeartbeatStatus(status: Partial<HeartbeatStatus>): Promise<void> {
    if (!fs.existsSync(this.heartbeatPath)) return;

    let content = fs.readFileSync(this.heartbeatPath, 'utf8');

    if (status.lastRun !== undefined) {
      content = content.replace(/Last Run:.*/g, `Last Run: ${status.lastRun}`);
    }
    if (status.nextRun !== undefined) {
      content = content.replace(/Next Run:.*/g, `Next Run: ${status.nextRun}`);
    }
    if (status.status !== undefined) {
      content = content.replace(/^Status:.*/gm, `Status: ${status.status}`);
    }
    if (status.currentTask !== undefined) {
      content = content.replace(/^Current Task:.*/gm, `Current Task: ${status.currentTask}`);
    }

    fs.writeFileSync(this.heartbeatPath, content, 'utf8');
  }
}
