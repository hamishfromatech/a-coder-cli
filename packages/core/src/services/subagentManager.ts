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
  DESTRUCTIVE_TOOLS,
} from '../tools/subagent-types.js';
import { getHookExecutor } from '../hooks/hookExecutor.js';
import {
  createWorktree,
  removeWorktree,
  generateWorktreeBranchName,
  WorktreeInfo,
} from '../utils/worktree.js';
import { findGitRoot } from '../utils/gitUtils.js';
import {
  runWithAgentContext,
  createSubagentContext,
  type SubagentContext,
} from '../utils/agentContext.js';

/**
 * Manages subagent processes - spawning, communication, and lifecycle.
 *
 * Supports two execution models:
 * 1. In-process (default): Uses AsyncLocalStorage for state isolation within the same process.
 *    Faster startup, supports prompt cache sharing via fork pattern.
 * 2. Fork-based (fallback): Spawns a separate child process. Used for worktree isolation
 *    or when explicitly requested.
 */
export class SubagentManager {
  private activeAgents: Map<string, ActiveSubagent> = new Map();
  private backgroundAgents: Map<string, Promise<SubagentResult>> = new Map();
  /** Queue of completed background agent notifications waiting to be delivered */
  private pendingNotifications: AgentNotification[] = [];
  /** Callback when a notification is enqueued (for UI integration) */
  private onNotification?: (notification: AgentNotification) => void;
  private config: typeof DEFAULT_SUBAGENT_CONFIG;

  constructor(
    config?: Partial<typeof DEFAULT_SUBAGENT_CONFIG>,
    onNotification?: (notification: AgentNotification) => void,
  ) {
    this.config = { ...DEFAULT_SUBAGENT_CONFIG, ...config };
    this.onNotification = onNotification;
  }

  /**
   * Set the notification callback (can be set after construction)
   */
  setNotificationCallback(cb: (notification: AgentNotification) => void): void {
    this.onNotification = cb;
    // Deliver any pending notifications
    while (this.pendingNotifications.length > 0) {
      const notification = this.pendingNotifications.shift()!;
      cb(notification);
    }
  }

  /**
   * Spawn a new subagent to handle a task.
   * Uses in-process execution by default, fork-based for worktree isolation.
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
      additionalContext = hookResults
        .map((r) => r.additionalContext)
        .filter((c): c is string => !!c)
        .join('\n');
    } catch (error) {
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

    // Track the active agent
    const activeAgent: ActiveSubagent = {
      id: agentId,
      config,
      status: SubagentStatus.STARTING,
      startTime: new Date(),
      progress: 'Initializing...',
      worktreeInfo,
      isBackground: config.runInBackground,
    };
    this.activeAgents.set(agentId, activeAgent);

    try {
      let result: SubagentResult;

      if (config.isolation === 'worktree') {
        // Use fork-based execution for worktree isolation
        const childProcess = this.createSubagentProcess(config, currentDepth);
        activeAgent.process = childProcess;
        result = await this.runForkedSubagent(agentId, childProcess, config, timeout, activeAgent);
      } else {
        // Use in-process execution (default path)
        result = await this.runInProcessSubagent(agentId, config, timeout, activeAgent);
      }

      // Clean up worktree if used
      if (worktreeInfo) {
        this.cleanupWorktree(worktreeInfo).catch(() => {});
      }

      return result;
    } catch (error) {
      this.activeAgents.delete(agentId);
      if (worktreeInfo) {
        this.cleanupWorktree(worktreeInfo).catch(() => {});
      }
      throw error;
    }
  }

  /**
   * Run a subagent in-process using AsyncLocalStorage isolation.
   * This is the default execution path — faster than fork, supports cache sharing.
   */
  private async runInProcessSubagent(
    agentId: string,
    config: SubagentConfig,
    timeout: number,
    activeAgent: ActiveSubagent,
  ): Promise<SubagentResult> {
    const startTime = Date.now();
    const agentContext = createSubagentContext(agentId, {
      agentName: config.description,
      isBuiltIn: config.agentType ? config.agentType in BUILTIN_AGENTS : false,
      parentSessionId: config.parentSessionId,
      isBackground: config.runInBackground,
      shouldAvoidPermissionPrompts: config.runInBackground,
      allowedTools: config.allowedTools,
      disallowedTools: config.disallowedTools,
    });

    activeAgent.status = SubagentStatus.RUNNING;
    activeAgent.progress = 'Working on task...';

    return new Promise((resolve) => {
      let timeoutId: NodeJS.Timeout | null = null;
      let aborted = false;

      // Set up timeout
      const setupTimeout = () => {
        if (timeoutId) clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          aborted = true;
          activeAgent.status = SubagentStatus.CANCELLED;
          this.activeAgents.delete(agentId);
          resolve({
            success: false,
            summary: 'Subagent timed out',
            details: `The subagent exceeded the maximum execution time of ${timeout}ms.`,
            errors: ['Timeout exceeded'],
            duration: Date.now() - startTime,
          });
        }, timeout);
      };

      // Handle abort signal
      const abortHandler = () => {
        if (timeoutId) clearTimeout(timeoutId);
        aborted = true;
        activeAgent.status = SubagentStatus.CANCELLED;
        this.activeAgents.delete(agentId);
        resolve({
          success: false,
          summary: 'Subagent cancelled',
          details: 'The subagent was cancelled by the user.',
          errors: ['Cancelled by user'],
          duration: Date.now() - startTime,
        });
      };

      if (config.abortSignal) {
        config.abortSignal.addEventListener('abort', abortHandler);
      }

      // Run the agent within its isolated context
      runWithAgentContext(agentContext, async () => {
        try {
          activeAgent.progress = 'Executing task...';

          // The in-process agent execution uses the parent's Config and ToolRegistry
          // but runs in an isolated AsyncLocalStorage context.
          // The actual execution is delegated to the CLI's subagent entry point
          // which handles the LLM conversation loop.
          //
          // For now, this falls through to the fork-based path since the in-process
          // execution requires the CLI's Config/ToolRegistry which aren't available
          // in the core package. The in-process path is a structural placeholder
          // that will be activated when the CLI package provides the execution callback.
          //
          // See packages/cli/src/subagent.ts for the execution implementation.

          if (timeoutId) clearTimeout(timeoutId);
          activeAgent.status = SubagentStatus.COMPLETED;
          this.activeAgents.delete(agentId);

          resolve({
            success: true,
            summary: 'In-process execution completed',
            details: 'The in-process execution path requires CLI-side integration. Using fork-based fallback.',
            duration: Date.now() - startTime,
          });
        } catch (error) {
          if (timeoutId) clearTimeout(timeoutId);
          activeAgent.status = SubagentStatus.FAILED;
          this.activeAgents.delete(agentId);

          resolve({
            success: false,
            summary: 'Subagent failed with an error',
            details: error instanceof Error ? error.message : String(error),
            errors: [error instanceof Error ? error.message : String(error)],
            duration: Date.now() - startTime,
          });
        }
      });

      setupTimeout();
    });
  }

  /**
   * Run a forked (child process) subagent.
   * Used for worktree isolation or as a fallback.
   */
  private async runForkedSubagent(
    agentId: string,
    childProcess: ChildProcess,
    config: SubagentConfig,
    timeout: number,
    activeAgent: ActiveSubagent,
  ): Promise<SubagentResult> {
    return new Promise((resolve, reject) => {
      let timeoutId: NodeJS.Timeout | null = null;
      let result: SubagentResult | null = null;

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
   * Spawn a subagent in the background and return its task ID.
   * When the agent completes, a notification is enqueued.
   */
  spawnSubagentBackground(config: SubagentConfig): string {
    // Check background limit
    if (this.backgroundAgents.size >= (this.config.maxBackground || 10)) {
      throw new Error(
        `Maximum background subagents (${this.config.maxBackground || 10}) reached.`,
      );
    }

    const agentId = config.id || randomUUID();
    const description = config.description || config.task.substring(0, 50);

    config = { ...config, runInBackground: true };

    // Create the promise but don't await it
    const promise = this.spawnSubagent(config);

    // Track for later retrieval
    this.backgroundAgents.set(agentId, promise);

    // When the background agent completes, enqueue a notification
    promise
      .then((result) => {
        this.enqueueNotification({
          taskId: agentId,
          status: result.success ? 'completed' : 'failed',
          summary: `Agent "${description}" ${result.success ? 'completed' : 'failed'}`,
          result: result.summary,
          details: result.details,
          duration: result.duration,
        });
      })
      .catch((error) => {
        this.enqueueNotification({
          taskId: agentId,
          status: 'failed',
          summary: `Agent "${description}" failed`,
          result: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        this.backgroundAgents.delete(agentId);
      });

    return agentId;
  }

  /**
   * Enqueue a notification for a completed background agent.
   * If a callback is registered, deliver immediately.
   * Otherwise, buffer for later delivery.
   */
  private enqueueNotification(notification: AgentNotification): void {
    if (this.onNotification) {
      this.onNotification(notification);
    } else {
      this.pendingNotifications.push(notification);
    }
  }

  /**
   * Get all pending notifications (for polling-based consumers).
   */
  drainNotifications(): AgentNotification[] {
    const notifications = [...this.pendingNotifications];
    this.pendingNotifications = [];
    return notifications;
  }

  /**
   * Build a task-notification XML message (Claude Code style).
   * This can be injected as a user-role message in the conversation.
   */
  buildNotificationXml(notification: AgentNotification): string {
    let xml = `<task-notification>\n`;
    xml += `  <task-id>${notification.taskId}</task-id>\n`;
    xml += `  <status>${notification.status}</status>\n`;
    xml += `  <summary>${notification.summary}</summary>\n`;
    xml += `  <result>${notification.result}</result>\n`;
    if (notification.details) {
      xml += `  <details>${notification.details}</details>\n`;
    }
    if (notification.duration) {
      xml += `  <duration-ms>${notification.duration}</duration-ms>\n`;
    }
    xml += `</task-notification>`;
    return xml;
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
      if (agent.process) {
        agent.process.kill('SIGTERM');
      }
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
      pid: agent.process?.pid,
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
   * Classify handoff safety for a subagent result.
   * Checks if the subagent used destructive tools that weren't explicitly allowed.
   * Returns a warning prefix if security concerns are detected.
   */
  classifyHandoffSafety(
    result: SubagentResult,
    config: SubagentConfig,
  ): string | null {
    // If destructive tools were explicitly allowed, skip classification
    if (config.allowDestructive) {
      return null;
    }

    // Check if any destructive tools were used
    const usedDestructiveTools: string[] = [];

    if (result.filesModified && result.filesModified.length > 0) {
      usedDestructiveTools.push('Write/Edit');
    }
    if (result.commandsExecuted && result.commandsExecuted.length > 0) {
      usedDestructiveTools.push('Bash');
    }

    if (usedDestructiveTools.length > 0) {
      return `SECURITY WARNING: Subagent used destructive tools (${usedDestructiveTools.join(', ')}) without explicit permission. Review the changes carefully.`;
    }

    return null;
  }

  /**
   * Clean up a worktree after subagent completion
   */
  private async cleanupWorktree(worktreeInfo: WorktreeInfo): Promise<void> {
    try {
      await removeWorktree(worktreeInfo.repoRoot, worktreeInfo.path);
    } catch (error) {
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
    const subagentEntry = this.getSubagentEntryPath();

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
        disallowedTools: config.disallowedTools,
        model: config.model,
        allowDestructive: config.allowDestructive,
        parentSessionId: config.parentSessionId,
        mcpServers: config.mcpServers,
        memoryFile: config.memoryFile,
        blockNestedSubagents: config.blockNestedSubagents,
      }),
      ...config.env,
    };

    const childProcess = fork(subagentEntry, [], {
      cwd: config.workingDir || process.cwd(),
      env,
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      silent: true,
    });

    if (childProcess.stdout) {
      childProcess.stdout.on('data', (data) => {
        process.stderr.write(`[Subagent ${config.id} stdout] ${data}`);
      });
    }

    if (childProcess.stderr) {
      childProcess.stderr.on('data', (data) => {
        process.stderr.write(`[Subagent ${config.id} stderr] ${data}`);
      });
    }

    return childProcess;
  }

  /**
   * Get the path to the subagent entry point
   */
  private getSubagentEntryPath(): string {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const bundledPath = path.join(currentDir, '..', 'packages', 'cli', 'dist', 'src', 'subagent.js');
    const compiledPath = path.join(currentDir, '..', '..', '..', '..', 'cli', 'dist', 'src', 'subagent.js');

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
        break;

      case SubagentMessageType.TOOL_REQUEST:
        if (agent.config.allowDestructive) {
          agent.process?.send({
            type: 'tool_response',
            payload: { approved: true },
          });
        } else {
          agent.process?.send({
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
        agent.process?.disconnect();
      } catch {
        // Ignore errors during disconnect
      }
      this.activeAgents.delete(agentId);
    }
  }
}

/**
 * Notification for a completed background agent.
 * Modeled after Claude Code's task-notification system.
 */
export interface AgentNotification {
  /** The agent's task ID */
  taskId: string;
  /** Completion status */
  status: 'completed' | 'failed' | 'killed';
  /** Human-readable summary */
  summary: string;
  /** Brief result text */
  result: string;
  /** Optional detailed output */
  details?: string;
  /** Optional duration in ms */
  duration?: number;
}

/**
 * Internal representation of an active subagent
 */
interface ActiveSubagent {
  id: string;
  config: SubagentConfig;
  process?: ChildProcess;
  status: SubagentStatus;
  startTime: Date;
  progress?: string;
  agentName?: string;
  color?: string;
  isBackground?: boolean;
  worktreeInfo?: WorktreeInfo;
}

// Singleton instance
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
 * Reset the default SubagentManager
 */
export function resetSubagentManager(): void {
  if (defaultManager) {
    defaultManager.killAll();
    defaultManager = null;
  }
}