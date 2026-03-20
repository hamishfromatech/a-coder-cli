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
  BUILTIN_AGENTS,
  BuiltinAgentType,
} from '../tools/subagent-types.js';
import { getHookExecutor } from '../hooks/hookExecutor.js';
import {
  createWorktree,
  removeWorktree,
  generateWorktreeBranchName,
  WorktreeInfo,
} from '../utils/worktree.js';
import { findGitRoot } from '../utils/gitUtils.js';

/**
 * Manages subagent processes - spawning, communication, and lifecycle
 */
export class SubagentManager {
  private activeAgents: Map<string, ActiveSubagent> = new Map();
  private backgroundAgents: Map<string, Promise<SubagentResult>> = new Map();
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

    // Execute SubagentStart hooks
    let additionalContext = '';
    try {
      const hookExecutor = getHookExecutor(
        config.parentSessionId || 'unknown',
        config.workingDir || process.cwd(),
      );
      const hookResults = await hookExecutor.executeSubagentStartHooks(
        agentId,
        config.agentType || 'general-purpose',
        config.task,
        config.allowDestructive,
        config.isolation,
      );
      // Collect additional context from hooks
      additionalContext = hookResults
        .map((r) => r.additionalContext)
        .filter((c): c is string => !!c)
        .join('\n');
    } catch (error) {
      // Hooks are optional, continue without them
      console.warn('SubagentStart hooks failed:', error);
    }

    // Add hook context to task
    if (additionalContext) {
      config = {
        ...config,
        context: (config.context || '') + '\n\n' + additionalContext,
      };
    }

    // Handle worktree isolation
    let worktreeInfo: WorktreeInfo | undefined;
    if (config.isolation === 'worktree') {
      const repoRoot = findGitRoot(config.workingDir || process.cwd());
      if (repoRoot) {
        try {
          const branchName = generateWorktreeBranchName('subagent');
          worktreeInfo = await createWorktree(repoRoot, branchName);
          config = { ...config, workingDir: worktreeInfo.path };
        } catch (error) {
          console.warn('Failed to create worktree, using original directory:', error);
        }
      }
    }

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
      worktreeInfo,
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
          // Clean up worktree if used
          if (worktreeInfo) {
            this.cleanupWorktree(worktreeInfo).catch(() => {});
          }
          resolve(result);
        } else if (message.type === SubagentMessageType.ERROR) {
          const errorMsg = (message as SubagentErrorMessage).payload;
          if (timeoutId) clearTimeout(timeoutId);
          activeAgent.status = SubagentStatus.FAILED;
          this.cleanup(agentId);
          // Clean up worktree if used
          if (worktreeInfo) {
            this.cleanupWorktree(worktreeInfo).catch(() => {});
          }
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

        // Clean up worktree if used
        if (worktreeInfo) {
          this.cleanupWorktree(worktreeInfo).catch(() => {});
        }

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
        // Clean up worktree if used
        if (worktreeInfo) {
          this.cleanupWorktree(worktreeInfo).catch(() => {});
        }
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
   * Spawn a subagent in the background and return its task ID
   */
  spawnSubagentBackground(config: SubagentConfig): string {
    // Check background limit
    if (this.backgroundAgents.size >= (this.config.maxBackground || 10)) {
      throw new Error(
        `Maximum background subagents (${this.config.maxBackground || 10}) reached.`,
      );
    }

    const agentId = config.id || randomUUID();

    // Create the promise but don't await it
    const promise = this.spawnSubagent(config);

    // Track for later retrieval
    this.backgroundAgents.set(agentId, promise);

    // Clean up when done
    promise.finally(() => {
      this.backgroundAgents.delete(agentId);
    });

    return agentId;
  }

  /**
   * Get the result of a background subagent
   */
  getBackgroundResult(agentId: string): Promise<SubagentResult> | undefined {
    return this.backgroundAgents.get(agentId);
  }

  /**
   * Check if a background subagent is still running
   */
  isBackgroundRunning(agentId: string): boolean {
    return this.backgroundAgents.has(agentId);
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
      agentType: agent.config.agentType,
      agentName: agent.agentName,
      status: agent.status,
      task: agent.config.task,
      description: agent.config.description,
      startTime: agent.startTime,
      pid: agent.process.pid,
      progress: agent.progress,
      color: agent.color,
      isBackground: agent.isBackground,
      workingDir: agent.config.workingDir,
    }));
  }

  /**
   * Get the number of active subagents
   */
  getActiveCount(): number {
    return this.activeAgents.size;
  }

  /**
   * Get the number of background subagents
   */
  getBackgroundCount(): number {
    return this.backgroundAgents.size;
  }

  /**
   * Clean up a worktree after subagent completion
   */
  private async cleanupWorktree(worktreeInfo: WorktreeInfo): Promise<void> {
    try {
      await removeWorktree(worktreeInfo.repoRoot, worktreeInfo.path);
    } catch (error) {
      // Log but don't throw - worktree cleanup is best-effort
      console.warn(`Failed to cleanup worktree ${worktreeInfo.path}:`, error);
    }
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
    // When bundled, import.meta.url points to bundle/a-coder.js
    // When running from source, it's in packages/core/dist/src/services/
    // We need to find the cli package's dist/src/subagent.js

    // Try to find the subagent relative to the current module location
    const currentDir = path.dirname(fileURLToPath(import.meta.url));

    // When bundled (bundle/a-coder.js), go up one level to root, then into packages/cli
    const bundledPath = path.join(currentDir, '..', 'packages', 'cli', 'dist', 'src', 'subagent.js');

    // When running from compiled core (packages/core/dist/src/services/), go up 4 levels
    const compiledPath = path.join(currentDir, '..', '..', '..', '..', 'cli', 'dist', 'src', 'subagent.js');

    // Return whichever path exists (prefer bundled path)
    const fs = require('fs');
    if (fs.existsSync(bundledPath)) {
      return bundledPath;
    }
    return compiledPath;
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
  /** Agent display name */
  agentName?: string;
  /** Agent color for UI */
  color?: string;
  /** Whether running in background mode */
  isBackground?: boolean;
  /** Worktree info if using worktree isolation */
  worktreeInfo?: WorktreeInfo;
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