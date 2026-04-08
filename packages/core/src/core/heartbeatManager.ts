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

export interface ParsedHeartbeatTask {
  id: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed';
}

export interface HeartbeatStatus {
  lastRun: string | null;
  nextRun: string | null;
  status: 'idle' | 'running' | 'completed' | 'error';
  currentTask: string | null;
}

/**
 * Parses tasks from heartbeat.md file
 * @param content The content of heartbeat.md
 * @returns Array of parsed tasks
 */
export function parseHeartbeatTasks(content: string): ParsedHeartbeatTask[] {
  const tasks: ParsedHeartbeatTask[] = [];
  const lines = content.split('\n');
  let currentTask: Partial<ParsedHeartbeatTask> = {};

  for (const line of lines) {
    const pendingMatch = line.match(/^\s*[-*]\s*\[\s*\]\s*(.+)$/);
    const inProgressMatch = line.match(/^\s*[-*]\s*\[!\]\s*(.+)$/);
    const completedMatch = line.match(/^\s*[-*]\s*\[x\]\s*(.+)$/i);

    if (pendingMatch) {
      if (currentTask.description) {
        tasks.push(currentTask as ParsedHeartbeatTask);
      }
      currentTask = { description: pendingMatch[1].trim(), status: 'pending' };
    } else if (inProgressMatch) {
      if (currentTask.description) {
        tasks.push(currentTask as ParsedHeartbeatTask);
      }
      currentTask = { description: inProgressMatch[1].trim(), status: 'in_progress' };
    } else if (completedMatch) {
      if (currentTask.description) {
        tasks.push(currentTask as ParsedHeartbeatTask);
      }
      currentTask = { description: completedMatch[1].trim(), status: 'completed' };
    }
  }

  // Don't forget the last task
  if (currentTask.description) {
    tasks.push(currentTask as ParsedHeartbeatTask);
  }

  // Assign IDs
  return tasks.map((task, index) => ({
    ...task,
    id: String(index + 1),
  }));
}

/**
 * Gets the path to the heartbeat.md file for a given target directory
 */
export function getHeartbeatPath(targetDir: string): string {
  return path.join(targetDir, GEMINI_DIR, 'heartbeat.md');
}

/**
 * Manages heartbeat mode scheduling and task execution.
 * Runs tasks from heartbeat.md on a specified interval by spawning child CLI processes.
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
  private cliPath: string;

  constructor(config: Config, heartbeatConfig?: Partial<HeartbeatConfig>) {
    this.config = config;
    this.intervalMs = (heartbeatConfig?.intervalMinutes ?? 10) * 60 * 1000;
    this.maxIterations = heartbeatConfig?.maxIterations ?? -1; // -1 = infinite
    this.heartbeatPath = getHeartbeatPath(config.getTargetDir());
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
      // Read tasks from heartbeat.md
      const tasks = await this.readHeartbeatTasks();
      const pendingTasks = tasks.filter((t) => t.status === 'pending');

      if (pendingTasks.length === 0) {
        console.log('[Heartbeat] No pending tasks. Skipping.');
        await this.updateHeartbeatStatus({ status: 'idle', currentTask: null });
        return;
      }

      // Get the first pending task
      const currentTask = pendingTasks[0];
      console.log(`[Heartbeat] Processing task: ${currentTask.id} - ${currentTask.description}`);

      await this.updateHeartbeatStatus({
        status: 'running',
        currentTask: currentTask.id,
      });

      // Execute the task by spawning a child CLI process
      await this.executeTask(currentTask);

      // Mark task as completed
      await this.markTaskCompleted(currentTask.id);

      console.log(`[Heartbeat] Completed task: ${currentTask.id}`);

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

  private async readHeartbeatTasks(): Promise<ParsedHeartbeatTask[]> {
    if (!fs.existsSync(this.heartbeatPath)) {
      return [];
    }

    const content = fs.readFileSync(this.heartbeatPath, 'utf8');
    return parseHeartbeatTasks(content);
  }

  private async markTaskCompleted(taskId: string): Promise<void> {
    if (!fs.existsSync(this.heartbeatPath)) return;

    let content = fs.readFileSync(this.heartbeatPath, 'utf8');
    const lines = content.split('\n');
    let taskCounter = 0;

    const updatedLines = lines.map((line) => {
      // Match any task line (pending, in_progress, or already completed)
      const match = line.match(/^(\s*[-*]\s*\[)[ x!]\](.*)$/);
      if (match) {
        taskCounter++;
        if (taskCounter === parseInt(taskId)) {
          // Mark as completed
          return `${match[1]}x\]${match[2]}`;
        }
      }
      return line;
    });

    fs.writeFileSync(this.heartbeatPath, updatedLines.join('\n'), 'utf8');
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

  /**
   * Execute a task by spawning a child CLI process
   */
  private executeTask(task: ParsedHeartbeatTask): Promise<void> {
    return new Promise((resolve, reject) => {
      const prompt = `Task: ${task.description}

Please complete this task. When done, update the heartbeat.md file by marking the task as completed using the edit tool. Mark the task as completed when you finish the task or if you determine it cannot be completed.`;

      const taskPromptId = `heartbeat-${task.id}-${Date.now()}`;

      // Build CLI arguments
      const cliArgs = [
        '--prompt', prompt,
        '--yolo', // Run in YOLO mode for automated execution
      ];

      console.log(`[Heartbeat] Spawning CLI for task ${task.id}...`);

      const child = spawn(this.cliPath, cliArgs, {
        cwd: this.config.getTargetDir(),
        stdio: 'inherit',
        env: {
          ...process.env,
          HEARTBEAT_TASK_ID: task.id,
          HEARTBEAT_SESSION_ID: taskPromptId,
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
}
