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
  | 'SessionStart';

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
 * Hook configuration with optional matcher
 */
export interface HookConfig {
  /** Optional matcher to filter when this hook runs */
  matcher?: string;
  /** The hooks to execute */
  hooks: HookCommand[];
}

/**
 * Hooks configuration object - matches Claude Code's settings.local.json format
 */
export interface HooksSettings {
  Stop?: HookConfig[];
  UserPromptSubmit?: HookConfig[];
  Notification?: HookConfig[];
  SessionStart?: HookConfig[];
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
 * Union of all hook contexts
 */
export type HookContext =
  | StopHookContext
  | UserPromptSubmitHookContext
  | NotificationHookContext
  | SessionStartHookContext;

/**
 * Result from executing a hook
 */
export interface HookResult {
  success: boolean;
  output?: string;
  error?: string;
  additionalContext?: string;
}

/**
 * Attribution settings for commits
 */
export interface AttributionSettings {
  commit?: string;
}