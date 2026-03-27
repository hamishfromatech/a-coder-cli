/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config, GitService, Logger, SessionManager } from '@a-coder/core';
import { LoadedSettings } from '../../config/settings.js';
import { UseHistoryManagerReturn } from '../hooks/useHistoryManager.js';
import { SessionStatsState } from '../contexts/SessionContext.js';

// Grouped dependencies for clarity and easier mocking
export interface CommandContext {
  // Core services and configuration
  services: {
    // TODO(abhipatel12): Ensure that config is never null.
    config: Config | null;
    settings: LoadedSettings;
    git: GitService | undefined;
    logger: Logger;
  };
  // UI state and history management
  ui: {
    // TODO - As more commands are add some additions may be needed or reworked using this new context.
    // Ex.
    // history: HistoryItem[];
    // pendingHistoryItems: HistoryItemWithoutId[];

    /** Adds a new item to the history display. */
    addItem: UseHistoryManagerReturn['addItem'];
    /** Clears all history items and the console screen. */
    clear: () => void;
    /**
     * Sets the transient debug message displayed in the application footer in debug mode.
     */
    setDebugMessage: (message: string) => void;
  };
  // Session-specific data
  session: {
    stats: SessionStatsState;
  };
  // Session manager for persistent sessions
  sessionManager?: SessionManager;
}

/**
 * Command category for grouping commands in the help menu
 */
export type CommandCategory =
  | 'general' // General purpose commands (help, clear, etc.)
  | 'agent' // Agent-related commands
  | 'skill' // Skill-related commands
  | 'plugin' // Plugin management commands
  | 'session' // Session management commands
  | 'config' // Configuration commands (theme, auth, etc.)
  | 'memory' // Memory-related commands
  | 'advanced'; // Advanced commands (debug, etc.)

/**
 * The return type for a command action that results in scheduling a tool call.
 */
export interface ToolActionReturn {
  type: 'tool';
  toolName: string;
  toolArgs: Record<string, unknown>;
  /**
   * Whether this is a client-initiated tool call.
   * - true (default): The tool result is NOT sent to the LLM. Use for informational tools.
   * - false: The tool result IS sent to the LLM for processing. Use when the LLM should act on the result.
   * For skills with action 'execute', this should be false so the LLM processes the skill content.
   */
  isClientInitiated?: boolean;
}

/**
 * The return type for a command action that results in a simple message
 * being displayed to the user.
 */
export interface MessageActionReturn {
  type: 'message';
  messageType: 'info' | 'error';
  content: string;
}

/**
 * The return type for a command action that needs to open a dialog.
 */
export interface OpenDialogActionReturn {
  type: 'dialog';
  dialog: 'help' | 'auth' | 'theme' | 'privacy' | 'editor' | 'skills';
}

export type SlashCommandActionReturn =
  | ToolActionReturn
  | MessageActionReturn
  | OpenDialogActionReturn;

/**
 * Argument hint for displaying expected arguments in the command menu
 */
export interface ArgumentHint {
  /** Name of the argument */
  name: string;
  /** Is this argument required? */
  required?: boolean;
  /** Description of what this argument does */
  description?: string;
  /** Possible values for this argument (for autocomplete) */
  options?: string[];
}

// The standardized contract for any command in the system.
export interface SlashCommand {
  name: string;
  altName?: string;
  description?: string;

  /** Category for grouping in help menu */
  category?: CommandCategory;

  /** Argument hints for display in command suggestions */
  argumentHint?: string | ArgumentHint[];

  /** Usage examples for the command */
  examples?: string[];

  /** Keywords for fuzzy search (in addition to name and description) */
  keywords?: string[];

  // The action to run. Optional for parent commands that only group sub-commands.
  action?: (
    context: CommandContext,
    args: string,
  ) =>
    | void
    | SlashCommandActionReturn
    | Promise<void | SlashCommandActionReturn>;

  // Provides argument completion (e.g., completing a tag for `/chat resume <tag>`).
  completion?: (
    context: CommandContext,
    partialArg: string,
  ) => Promise<string[]>;

  subCommands?: SlashCommand[];
}
