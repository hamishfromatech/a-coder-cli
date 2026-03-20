/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Hook types compatible with Claude Code's hook system for Dash integration.
 */

/**
 * Hook event names that can be triggered
 */
export type HookEventName =
  | 'Stop'
  | 'UserPromptSubmit'
  | 'Notification'
  | 'SessionStart'
  | 'SubagentStart'
  | 'PreToolUse';

/**
 * Notification types for the Notification hook
 */
export type NotificationType =
  | 'permission_prompt'
  | 'idle_prompt'
  | 'auth_success'
  | 'elicitation_dialog';

/**
 * Individual hook command configuration
 */
export interface HookCommand {
  type: 'command';
  command: string;
}

/**
 * LLM-based prompt hook configuration
 * Allows AI validation of tool calls
 */
export interface PromptHook {
  type: 'prompt';
  prompt: string;
  timeout?: number;
}

/**
 * Hook configuration with optional matcher
 */
export interface HookConfig {
  /** Optional matcher to filter when this hook runs */
  matcher?: string;
  /** The hooks to execute */
  hooks: Array<HookCommand | PromptHook>;
}

/**
 * Hooks configuration object - matches Claude Code's settings.local.json format
 */
export interface HooksSettings {
  Stop?: HookConfig[];
  UserPromptSubmit?: HookConfig[];
  Notification?: HookConfig[];
  SessionStart?: HookConfig[];
  SubagentStart?: HookConfig[];
  PreToolUse?: HookConfig[];
}

/**
 * Context provided to Stop hooks
 */
export interface StopHookContext {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: 'Stop';
}

/**
 * Context provided to UserPromptSubmit hooks
 */
export interface UserPromptSubmitHookContext {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: 'UserPromptSubmit';
  prompt?: string;
}

/**
 * Context provided to Notification hooks
 */
export interface NotificationHookContext {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: 'Notification';
  message: string;
  title?: string;
  notification_type: NotificationType;
  permission_mode?: string;
}

/**
 * Context provided to SessionStart hooks
 */
export interface SessionStartHookContext {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: 'SessionStart';
}

/**
 * Context provided to SubagentStart hooks
 */
export interface SubagentStartHookContext {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: 'SubagentStart';
  /** Unique identifier for the subagent */
  agent_id: string;
  /** Type of agent (e.g., 'Explore', 'Plan', 'general-purpose', or custom) */
  agent_type: string;
  /** The task description for the subagent */
  task: string;
  /** Whether the subagent has destructive tools enabled */
  allow_destructive?: boolean;
  /** Isolation mode (e.g., 'worktree') */
  isolation?: string;
}

/**
 * Context provided to PreToolUse hooks
 */
export interface PreToolUseHookContext {
  session_id: string;
  transcript_path: string;
  cwd: string;
  hook_event_name: 'PreToolUse';
  /** Name of the tool being called */
  tool_name: string;
  /** Arguments passed to the tool */
  tool_input: Record<string, unknown>;
}

/**
 * Union of all hook contexts
 */
export type HookContext =
  | StopHookContext
  | UserPromptSubmitHookContext
  | NotificationHookContext
  | SessionStartHookContext
  | SubagentStartHookContext
  | PreToolUseHookContext;

/**
 * Result from executing a hook
 */
export interface HookResult {
  success: boolean;
  output?: string;
  error?: string;
  additionalContext?: string;
  /** For PreToolUse hooks: permission decision */
  permissionDecision?: 'allow' | 'deny' | 'ask';
  /** For PreToolUse hooks: modified tool input */
  updatedInput?: Record<string, unknown>;
  /** For PreToolUse hooks: explanation for user when decision is 'ask' */
  systemMessage?: string;
}

/**
 * Result from PreToolUse hooks with additional context
 */
export interface PreToolUseHookResult extends HookResult {
  /** Permission decision from the hook */
  permissionDecision?: 'allow' | 'deny' | 'ask';
  /** Modified tool input if hook wants to change arguments */
  updatedInput?: Record<string, unknown>;
  /** Explanation for user when asking for confirmation */
  systemMessage?: string;
}

/**
 * Attribution settings for commits
 */
export interface AttributionSettings {
  commit?: string;
}