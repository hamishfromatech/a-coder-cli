/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { fork, ChildProcess } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import {
  SubagentConfig,
  SubagentResult,
  SubagentStatus,
  SubagentInfo,
  SubagentMessage,
  SubagentMessageType,
  SubagentResultMessage,
  SubagentErrorMessage,
  SubagentProgressMessage,
  DEFAULT_SUBAGENT_CONFIG,
  SUBAGENT_MODE_ENV_VAR,
  SUBAGENT_CONFIG_ENV_VAR,
  SUBAGENT_DEPTH_ENV_VAR,
} from '../tools/subagent-types.js';

/**
 * Manages subagent processes - spawning, communication, and lifecycle
 */
export class SubagentManager {
  private activeAgents: Map<string, ActiveSubagent> = new Map();
  private config: typeof DEFAULT_SUBAGENT_CONFIG;

  constructor(config?: Partial<typeof DEFAULT_SUBAGENT_CONFIG>) {
    this.config = { ...DEFAULT_SUBAGENT_CONFIG, ...config };
  }

  /**
   * Spawn a new subagent to handle a task
   */
  async spawnSubagent(config: SubagentConfig): Promise<SubagentResult> {
    // Check concurrent limit
    if (this.activeAgents.size >= this.config.maxConcurrent) {
      throw new Error(
        `Maximum concurrent subagents (${this.config.maxConcurrent}) reached. ` +
          `Please wait for an existing subagent to complete.`,
      );
    }

    // Check nested depth
    const currentDepth = parseInt(process.env[SUBAGENT_DEPTH_ENV_VAR] || '0', 10);
    if (currentDepth >= this.config.maxNestedDepth) {
      throw new Error(
        `Maximum subagent nesting depth (${this.config.maxNestedDepth}) reached.`,
      );
    }

    const agentId = config.id || randomUUID();
    const timeout = config.timeout || this.config.defaultTimeout;

    // Create the subagent process
    const childProcess = this.createSubagentProcess(config, currentDepth);

    // Track the active agent
    const activeAgent: ActiveSubagent = {
      id: agentId,
      config,
      process: childProcess,
      status: SubagentStatus.STARTING,
      startTime: new Date(),
      progress: 'Initializing...',
    };
    this.activeAgents.set(agentId, activeAgent);

    // Set up promise-based communication
    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout | null = null;
      let result: SubagentResult | null = null;

      // Set up timeout
      const setupTimeout = () => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          activeAgent.status = SubagentStatus.CANCELLED;
          this.killSubagent(agentId);
          resolve({
            success: false,
            summary: 'Subagent timed out',
            details: `The subagent exceeded the maximum execution time of ${timeout}ms.`,
            errors: ['Timeout exceeded'],
            duration: Date.now() - activeAgent.startTime.getTime(),
          });
        }, timeout);
      };

      // Handle abort signal
      const abortHandler = () => {
        if (timeoutId) clearTimeout(timeoutId);
        activeAgent.status = SubagentStatus.CANCELLED;
        this.killSubagent(agentId);
        resolve({
          success: false,
          summary: 'Subagent cancelled',
          details: 'The subagent was cancelled by the user.',
          errors: ['Cancelled by user'],
          duration: Date.now() - activeAgent.startTime.getTime(),
        });
      };

      if (config.abortSignal) {
        config.abortSignal.addEventListener('abort', abortHandler);
      }

      // Handle messages from subagent
      childProcess.on('message', (message: SubagentMessage) => {
        this.handleSubagentMessage(agentId, message, activeAgent);

        if (message.type === SubagentMessageType.RESULT) {
          result = (message as SubagentResultMessage).payload;
          if (timeoutId) clearTimeout(timeoutId);
          activeAgent.status = result.success
            ? SubagentStatus.COMPLETED
            : SubagentStatus.FAILED;
          this.cleanup(agentId);
          resolve(result);
        } else if (message.type === SubagentMessageType.ERROR) {
          const errorMsg = (message as SubagentErrorMessage).payload;
          if (timeoutId) clearTimeout(timeoutId);
          activeAgent.status = SubagentStatus.FAILED;
          this.cleanup(agentId);
          resolve({
            success: false,
            summary: 'Subagent encountered an error',
            details: errorMsg.message,
            errors: [errorMsg.message],
            duration: Date.now() - activeAgent.startTime.getTime(),
          });
        }
      });

      // Handle process exit
      childProcess.on('exit', (code, signal) => {
        if (timeoutId) clearTimeout(timeoutId);
        this.activeAgents.delete(agentId);

        if (!result) {
          // Process exited without sending result
          if (signal === 'SIGTERM' || signal === 'SIGKILL') {
            resolve({
              success: false,
              summary: 'Subagent was terminated',
              details: `The subagent process was terminated with signal ${signal}.`,
              errors: [`Process terminated: ${signal}`],
              duration: Date.now() - activeAgent.startTime.getTime(),
            });
          } else if (code !== 0) {
            resolve({
              success: false,
              summary: 'Subagent process failed',
              details: `The subagent process exited with code ${code}.`,
              errors: [`Process exited with code ${code}`],
              duration: Date.now() - activeAgent.startTime.getTime(),
            });
          } else {
            // Normal exit but no result - shouldn't happen
            resolve({
              success: true,
              summary: 'Subagent completed',
              details: 'The subagent process completed but did not return a result.',
              duration: Date.now() - activeAgent.startTime.getTime(),
            });
          }
        }
      });

      // Handle process errors
      childProcess.on('error', (error) => {
        if (timeoutId) clearTimeout(timeoutId);
        activeAgent.status = SubagentStatus.FAILED;
        this.cleanup(agentId);
        resolve({
          success: false,
          summary: 'Failed to start subagent',
          details: error.message,
          errors: [error.message],
          duration: Date.now() - activeAgent.startTime.getTime(),
        });
      });

      setupTimeout();
    });
  }

  /**
   * Kill a specific subagent
   */
  async killSubagent(agentId: string): Promise<void> {
    const agent = this.activeAgents.get(agentId);
    if (agent) {
      agent.status = SubagentStatus.CANCELLED;
      agent.process.kill('SIGTERM');
      this.cleanup(agentId);
    }
  }

  /**
   * Kill all active subagents
   */
  async killAll(): Promise<void> {
    for (const [agentId] of this.activeAgents) {
      await this.killSubagent(agentId);
    }
  }

  /**
   * Get information about all active subagents
   */
  listActive(): SubagentInfo[] {
    return Array.from(this.activeAgents.values()).map((agent) => ({
      id: agent.id,
      status: agent.status,
      task: agent.config.task,
      startTime: agent.startTime,
      pid: agent.process.pid,
      progress: agent.progress,
    }));
  }

  /**
   * Get the number of active subagents
   */
  getActiveCount(): number {
    return this.activeAgents.size;
  }

  /**
   * Create a subagent child process
   */
  private createSubagentProcess(
    config: SubagentConfig,
    currentDepth: number,
  ): ChildProcess {
    // Determine the entry point for subagent mode
    const subagentEntry = this.getSubagentEntryPath();

    // Prepare environment
    const env: Record<string, string> = {
      ...process.env,
      [SUBAGENT_MODE_ENV_VAR]: 'true',
      [SUBAGENT_DEPTH_ENV_VAR]: String(currentDepth + 1),
      [SUBAGENT_CONFIG_ENV_VAR]: JSON.stringify({
        task: config.task,
        workingDir: config.workingDir,
        context: config.context,
        contextFiles: config.contextFiles,
        allowedTools: config.allowedTools,
        model: config.model,
        allowDestructive: config.allowDestructive,
        parentSessionId: config.parentSessionId,
      }),
      ...config.env,
    };

    // Fork the process
    const childProcess = fork(subagentEntry, [], {
      cwd: config.workingDir || process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      silent: true, // We'll handle stdout/stderr ourselves
    });

    // Capture stdout/stderr for debugging
    if (childProcess.stdout) {
      childProcess.stdout.on('data', (data) => {
        // Could log this for debugging
        process.stderr.write(`[Subagent ${config.id} stdout] ${data}`);
      });
    }

    if (childProcess.stderr) {
      childProcess.stderr.on('data', (data) => {
        // Could log this for debugging
        process.stderr.write(`[Subagent ${config.id} stderr] ${data}`);
      });
    }

    return childProcess;
  }

  /**
   * Get the path to the subagent entry point
   */
  private getSubagentEntryPath(): string {
    // In production, use the compiled JavaScript
    // The build outputs to dist/src/ not just dist/
    return path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '..',
      '..',
      'cli',
      'dist',
      'src',
      'subagent.js',
    );
  }

  /**
   * Handle a message from a subagent
   */
  private handleSubagentMessage(
    agentId: string,
    message: SubagentMessage,
    agent: ActiveSubagent,
  ): void {
    switch (message.type) {
      case SubagentMessageType.READY:
        agent.status = SubagentStatus.RUNNING;
        agent.progress = 'Working on task...';
        break;

      case SubagentMessageType.PROGRESS:
        agent.progress = (message as SubagentProgressMessage).payload.message;
        break;

      case SubagentMessageType.LOG:
        // Could forward to logging system
        break;

      case SubagentMessageType.TOOL_REQUEST:
        // For now, auto-approve if destructive tools are allowed
        // In the future, this could prompt the user
        if (agent.config.allowDestructive) {
          agent.process.send({
            type: 'tool_response',
            payload: { approved: true },
          });
        } else {
          agent.process.send({
            type: 'tool_response',
            payload: { approved: false, reason: 'Destructive tools not allowed' },
          });
        }
        break;
    }
  }

  /**
   * Clean up after a subagent
   */
  private cleanup(agentId: string): void {
    const agent = this.activeAgents.get(agentId);
    if (agent) {
      try {
        agent.process.disconnect();
      } catch {
        // Ignore errors during disconnect
      }
      this.activeAgents.delete(agentId);
    }
  }
}

/**
 * Internal representation of an active subagent
 */
interface ActiveSubagent {
  id: string;
  config: SubagentConfig;
  process: ChildProcess;
  status: SubagentStatus;
  startTime: Date;
  progress?: string;
}

// Singleton instance for convenience
let defaultManager: SubagentManager | null = null;

/**
 * Get the default SubagentManager instance
 */
export function getSubagentManager(
  config?: Partial<typeof DEFAULT_SUBAGENT_CONFIG>,
): SubagentManager {
  if (!defaultManager) {
    defaultManager = new SubagentManager(config);
  }
  return defaultManager;
}

/**
 * Reset the default SubagentManager (useful for testing)
 */
export function resetSubagentManager(): void {
  if (defaultManager) {
    defaultManager.killAll();
    defaultManager = null;
  }
}