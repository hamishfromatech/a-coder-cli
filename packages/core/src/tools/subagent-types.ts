/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Built-in agent types that come pre-configured
 */
export type BuiltinAgentType = 'general-purpose' | 'Explore' | 'Plan';

/**
 * Configuration for a specific agent type
 */
export interface AgentTypeConfig {
  /** Display name for the agent */
  name: string;

  /** Human-readable description */
  description: string;

  /** Model to use: 'haiku' | 'sonnet' | 'opus' | 'inherit' */
  model: string;

  /** Tools this agent is allowed to use (use ['*'] for all tools) */
  allowedTools: string[];

  /** Tools this agent is blocked from using */
  disallowedTools: string[];

  /** Color for UI display */
  color?: string;

  /** System prompt to use for this agent */
  systemPrompt?: string;
}

/**
 * Built-in agent configurations
 */
export const BUILTIN_AGENTS: Record<BuiltinAgentType, AgentTypeConfig> = {
  'general-purpose': {
    name: 'General Purpose',
    description:
      'Complex multi-step operations requiring exploration and modification',
    model: 'inherit',
    allowedTools: ['*'], // All tools
    disallowedTools: [],
    color: 'blue',
  },
  Explore: {
    name: 'Explore',
    description:
      'Fast, read-only codebase exploration. Uses a lighter model to keep results out of main context.',
    model: 'haiku',
    allowedTools: [
      'Read',
      'Glob',
      'Grep',
      'WebFetch',
      'WebSearch',
      'list_directory',
    ],
    disallowedTools: ['Write', 'Edit', 'Bash', 'shell'],
    color: 'cyan',
  },
  Plan: {
    name: 'Plan',
    description:
      'Research and gather context for implementation planning. Read-only operations.',
    model: 'inherit',
    allowedTools: [
      'Read',
      'Glob',
      'Grep',
      'WebFetch',
      'WebSearch',
      'list_directory',
      'Agent',
    ],
    disallowedTools: ['Write', 'Edit', 'Bash', 'shell'],
    color: 'purple',
  },
};

/**
 * Source type for an agent definition
 */
export type AgentSourceType = 'builtin' | 'user' | 'project' | 'plugin';

/**
 * Isolation mode for subagents
 */
export type IsolationMode = 'worktree' | undefined;

/**
 * Configuration for spawning a subagent
 */
export interface SubagentConfig {
  /** Unique identifier for this subagent instance */
  id: string;

  /** The task description for the subagent to accomplish */
  task: string;

  /** Agent type to use (built-in or custom) */
  agentType?: BuiltinAgentType | string;

  /** Short description (3-5 words) for display */
  description?: string;

  /** Working directory for the subagent (defaults to project root) */
  workingDir?: string;

  /** Relevant context to provide to the subagent */
  context?: string;

  /** Specific files to include in context */
  contextFiles?: string[];

  /** Subset of tool names to allow (default: all non-destructive tools) */
  allowedTools?: string[];

  /** Tools to explicitly block for this subagent */
  disallowedTools?: string[];

  /** Maximum execution time in milliseconds (default: 300000 = 5 min) */
  timeout?: number;

  /** Model to use for the subagent (default: same as main agent) */
  model?: string;

  /** Whether to allow destructive tools (edit, write_file, shell) */
  allowDestructive?: boolean;

  /** Run in background mode (returns task ID immediately) */
  runInBackground?: boolean;

  /** Isolation mode for the subagent */
  isolation?: IsolationMode;

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

  /** Agent type (built-in or custom) */
  agentType?: string;

  /** Display name for the agent */
  agentName?: string;

  /** Current status */
  status: SubagentStatus;

  /** Task description */
  task: string;

  /** Short description for display */
  description?: string;

  /** When the subagent was spawned */
  startTime: Date;

  /** Process ID */
  pid?: number;

  /** Current progress message */
  progress?: string;

  /** Color for UI display */
  color?: string;

  /** Whether running in background mode */
  isBackground?: boolean;

  /** Working directory (for worktree isolation) */
  workingDir?: string;
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

  /** Tools that are always blocked for subagents (alias for disallowedTools) */
  blockedTools?: string[];

  /** Tools that are always blocked for subagents */
  disallowedTools?: string[];

  /** Allow subagents to spawn more subagents */
  allowNestedSubagents: boolean;

  /** Maximum depth of nested subagents */
  maxNestedDepth: number;

  /** Maximum number of background subagents */
  maxBackground?: number;
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
  disallowedTools: [],
  allowNestedSubagents: false,
  maxNestedDepth: 1,
  maxBackground: 10,
};

/**
 * Destructive tools that require explicit permission
 */
export const DESTRUCTIVE_TOOLS = ['Write', 'Edit', 'Bash', 'shell', 'write_file', 'edit'];

/**
 * Read-only tools safe for exploration
 */
export const READ_ONLY_TOOLS = [
  'Read',
  'read_file',
  'read_many_files',
  'Glob',
  'glob',
  'Grep',
  'grep',
  'list_directory',
  'WebFetch',
  'web_fetch',
  'WebSearch',
  'web_search',
  'save_memory',
];

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