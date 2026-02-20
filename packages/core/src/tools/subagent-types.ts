/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Configuration for spawning a subagent
 */
export interface SubagentConfig {
  /** Unique identifier for this subagent instance */
  id: string;

  /** The task description for the subagent to accomplish */
  task: string;

  /** Working directory for the subagent (defaults to project root) */
  workingDir?: string;

  /** Relevant context to provide to the subagent */
  context?: string;

  /** Specific files to include in context */
  contextFiles?: string[];

  /** Subset of tool names to allow (default: all non-destructive tools) */
  allowedTools?: string[];

  /** Maximum execution time in milliseconds (default: 300000 = 5 min) */
  timeout?: number;

  /** Model to use for the subagent (default: same as main agent) */
  model?: string;

  /** Whether to allow destructive tools (edit, write_file, shell) */
  allowDestructive?: boolean;

  /** Environment variables to pass to the subagent */
  env?: Record<string, string>;

  /** Parent session ID for logging/telemetry */
  parentSessionId?: string;

  /** AbortSignal for cancellation */
  abortSignal?: AbortSignal;
}

/**
 * Result returned by a subagent after completion
 */
export interface SubagentResult {
  /** Whether the task completed successfully */
  success: boolean;

  /** Brief summary of what was accomplished (1-2 sentences) */
  summary: string;

  /** Detailed output from the subagent */
  details: string;

  /** Files that were modified by the subagent */
  filesModified?: string[];

  /** Files that were read by the subagent */
  filesRead?: string[];

  /** Shell commands that were executed */
  commandsExecuted?: string[];

  /** Any errors encountered */
  errors?: string[];

  /** Token usage statistics */
  tokenUsage?: {
    input: number;
    output: number;
    total: number;
  };

  /** Execution time in milliseconds */
  duration?: number;
}

/**
 * Status of a subagent
 */
export enum SubagentStatus {
  /** Subagent is starting up */
  STARTING = 'starting',
  /** Subagent is actively working on the task */
  RUNNING = 'running',
  /** Subagent completed successfully */
  COMPLETED = 'completed',
  /** Subagent failed with an error */
  FAILED = 'failed',
  /** Subagent was cancelled/timed out */
  CANCELLED = 'cancelled',
}

/**
 * Information about an active subagent
 */
export interface SubagentInfo {
  /** Unique identifier */
  id: string;

  /** Current status */
  status: SubagentStatus;

  /** Task description */
  task: string;

  /** When the subagent was spawned */
  startTime: Date;

  /** Process ID */
  pid?: number;

  /** Current progress message */
  progress?: string;
}

/**
 * Message types for IPC communication with subagent processes
 */
export enum SubagentMessageType {
  /** Subagent is ready to receive task */
  READY = 'ready',
  /** Subagent is sending a progress update */
  PROGRESS = 'progress',
  /** Subagent is requesting a tool execution (for approval) */
  TOOL_REQUEST = 'tool_request',
  /** Subagent has completed the task */
  RESULT = 'result',
  /** Subagent encountered an error */
  ERROR = 'error',
  /** Log message from subagent */
  LOG = 'log',
}

/**
 * Base message structure for IPC
 */
export interface SubagentMessage {
  type: SubagentMessageType;
  payload: unknown;
}

/**
 * Progress update message
 */
export interface SubagentProgressMessage extends SubagentMessage {
  type: SubagentMessageType.PROGRESS;
  payload: {
    message: string;
    percentage?: number;
  };
}

/**
 * Result message from subagent
 */
export interface SubagentResultMessage extends SubagentMessage {
  type: SubagentMessageType.RESULT;
  payload: SubagentResult;
}

/**
 * Error message from subagent
 */
export interface SubagentErrorMessage extends SubagentMessage {
  type: SubagentMessageType.ERROR;
  payload: {
    message: string;
    stack?: string;
  };
}

/**
 * Tool request message (for destructive operations that need approval)
 */
export interface SubagentToolRequestMessage extends SubagentMessage {
  type: SubagentMessageType.TOOL_REQUEST;
  payload: {
    toolName: string;
    args: Record<string, unknown>;
    description: string;
  };
}

/**
 * Configuration for the subagent system (in settings)
 */
export interface SubagentSystemConfig {
  /** Enable the subagent system */
  enabled: boolean;

  /** Maximum number of concurrent subagents */
  maxConcurrent: number;

  /** Default timeout in milliseconds */
  defaultTimeout: number;

  /** Tools that are always allowed for subagents */
  allowedTools: string[];

  /** Tools that are always blocked for subagents */
  blockedTools: string[];

  /** Allow subagents to spawn more subagents */
  allowNestedSubagents: boolean;

  /** Maximum depth of nested subagents */
  maxNestedDepth: number;
}

/**
 * Default subagent system configuration
 */
export const DEFAULT_SUBAGENT_CONFIG: SubagentSystemConfig = {
  enabled: true,
  maxConcurrent: 3,
  defaultTimeout: 300000, // 5 minutes
  allowedTools: [
    'read_file',
    'read_many_files',
    'glob',
    'grep',
    'list_directory',
    'web_fetch',
    'web_search',
    'save_memory',
  ],
  blockedTools: [],
  allowNestedSubagents: false,
  maxNestedDepth: 1,
};

/**
 * Environment variable to detect subagent mode
 */
export const SUBAGENT_MODE_ENV_VAR = 'A_CODER_SUBAGENT_MODE';

/**
 * Environment variable for subagent config (JSON)
 */
export const SUBAGENT_CONFIG_ENV_VAR = 'A_CODER_SUBAGENT_CONFIG';

/**
 * Environment variable for subagent depth tracking
 */
export const SUBAGENT_DEPTH_ENV_VAR = 'A_CODER_SUBAGENT_DEPTH';