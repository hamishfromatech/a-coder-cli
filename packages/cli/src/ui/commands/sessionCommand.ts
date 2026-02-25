/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  CommandContext,
  SlashCommand,
  SlashCommandActionReturn,
} from './types.js';
import { MessageType } from '../types.js';
import { SessionManager, SessionSummary } from '@a-coder/core';

/**
 * Format a session summary for display.
 */
function formatSessionSummary(session: SessionSummary, index: number): string {
  const date = new Date(session.updatedAt);
  const dateStr = date.toLocaleDateString();
  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const preview = session.preview ? ` - "${session.preview}"` : '';

  return `\u001b[36m${index + 1}.\u001b[0m \u001b[1m${session.name}\u001b[0m (${session.messageCount} messages, ${session.projectName}) - ${dateStr} ${timeStr}${preview}`;
}

/**
 * Get the session manager from the command context.
 */
function getSessionManager(context: CommandContext): SessionManager | null {
  return (context as any).sessionManager || null;
}

/**
 * Action for /session save [name]
 */
async function saveSessionAction(
  context: CommandContext,
  args: string,
): Promise<SlashCommandActionReturn | void> {
  const sessionManager = getSessionManager(context);
  if (!sessionManager) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Session manager not available.',
    };
  }

  const chat = context.services.config?.getGeminiClient()?.getChat();
  if (!chat) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'No chat client available.',
    };
  }

  const history = chat.getHistory();
  if (history.length === 0) {
    return {
      type: 'message',
      messageType: 'info',
      content: 'No conversation to save.',
    };
  }

  const name = args.trim() || undefined;
  const sessionId = sessionManager.getCurrentSessionId() || sessionManager.generateSessionId();

  try {
    const metadata = await sessionManager.saveSession(sessionId, history, {
      name,
      modelUsed: context.services.config?.getModel(),
    });

    sessionManager.setCurrentSessionId(sessionId);

    return {
      type: 'message',
      messageType: 'info',
      content: `Session saved: ${metadata.name} (${metadata.id})`,
    };
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to save session: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Action for /session list [--all]
 */
async function listSessionsAction(
  context: CommandContext,
  args: string,
): Promise<SlashCommandActionReturn | void> {
  const sessionManager = getSessionManager(context);
  if (!sessionManager) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Session manager not available.',
    };
  }

  const showAll = args.includes('--all') || args.includes('-a');
  const projectName = showAll ? undefined : context.services.config?.getProjectRoot()
    ? require('path').basename(context.services.config.getProjectRoot())
    : undefined;

  try {
    const sessions = await sessionManager.listSessions({
      projectName,
      limit: showAll ? undefined : 20,
      sortBy: 'updatedAt',
      sortOrder: 'desc',
    });

    if (sessions.length === 0) {
      return {
        type: 'message',
        messageType: 'info',
        content: showAll
          ? 'No saved sessions found.'
          : 'No saved sessions for this project. Use --all to see all sessions.',
      };
    }

    const header = showAll
      ? `Saved sessions (${sessions.length}):`
      : `Saved sessions for this project (${sessions.length}):`;

    const list = sessions
      .map((s, i) => formatSessionSummary(s, i))
      .join('\n');

    return {
      type: 'message',
      messageType: 'info',
      content: `${header}\n\n${list}\n\nUse \u001b[36m/session resume <name>\u001b[0m to restore a session.`,
    };
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to list sessions: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Action for /session resume <id|name>
 */
async function resumeSessionAction(
  context: CommandContext,
  args: string,
): Promise<SlashCommandActionReturn | void> {
  const sessionManager = getSessionManager(context);
  if (!sessionManager) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Session manager not available.',
    };
  }

  const idOrName = args.trim();
  if (!idOrName) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Usage: /session resume <id|name>',
    };
  }

  try {
    const sessionData = await sessionManager.getSession(idOrName);
    if (!sessionData) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Session not found: ${idOrName}`,
      };
    }

    const chat = context.services.config?.getGeminiClient()?.getChat();
    if (!chat) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'No chat client available.',
      };
    }

    // Clear current history
    chat.clearHistory();
    context.ui.clear();

    // Load session history
    for (const item of sessionData.history) {
      chat.addHistory(item);
    }

    sessionManager.setCurrentSessionId(sessionData.metadata.id);

    return {
      type: 'message',
      messageType: 'info',
      content: `Session restored: ${sessionData.metadata.name} (${sessionData.history.length} messages)`,
    };
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to resume session: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Action for /session delete <id|name>
 */
async function deleteSessionAction(
  context: CommandContext,
  args: string,
): Promise<SlashCommandActionReturn | void> {
  const sessionManager = getSessionManager(context);
  if (!sessionManager) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Session manager not available.',
    };
  }

  const idOrName = args.trim();
  if (!idOrName) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Usage: /session delete <id|name>',
    };
  }

  try {
    // First get the session to find its ID
    const sessionData = await sessionManager.getSession(idOrName);
    if (!sessionData) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Session not found: ${idOrName}`,
      };
    }

    const deleted = await sessionManager.deleteSession(sessionData.metadata.id);
    if (deleted) {
      return {
        type: 'message',
        messageType: 'info',
        content: `Session deleted: ${sessionData.metadata.name}`,
      };
    } else {
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to delete session: ${idOrName}`,
      };
    }
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to delete session: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Action for /session rename <id|name> <new-name>
 */
async function renameSessionAction(
  context: CommandContext,
  args: string,
): Promise<SlashCommandActionReturn | void> {
  const sessionManager = getSessionManager(context);
  if (!sessionManager) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Session manager not available.',
    };
  }

  const parts = args.trim().split(/\s+/);
  if (parts.length < 2) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Usage: /session rename <id|name> <new-name>',
    };
  }

  const idOrName = parts[0];
  const newName = parts.slice(1).join(' ');

  try {
    const sessionData = await sessionManager.getSession(idOrName);
    if (!sessionData) {
      return {
        type: 'message',
        messageType: 'error',
        content: `Session not found: ${idOrName}`,
      };
    }

    const renamed = await sessionManager.renameSession(sessionData.metadata.id, newName);
    if (renamed) {
      return {
        type: 'message',
        messageType: 'info',
        content: `Session renamed to: ${newName}`,
      };
    } else {
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to rename session: ${idOrName}`,
      };
    }
  } catch (error) {
    return {
      type: 'message',
      messageType: 'error',
      content: `Failed to rename session: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Action for /session auto [on|off]
 */
async function autoSessionAction(
  context: CommandContext,
  args: string,
): Promise<SlashCommandActionReturn | void> {
  const sessionManager = getSessionManager(context);
  if (!sessionManager) {
    return {
      type: 'message',
      messageType: 'error',
      content: 'Session manager not available.',
    };
  }

  const arg = args.trim().toLowerCase();

  if (arg === 'on') {
    const chat = context.services.config?.getGeminiClient()?.getChat();
    if (!chat) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'No chat client available.',
      };
    }

    // Ensure we have a session ID
    if (!sessionManager.getCurrentSessionId()) {
      const id = sessionManager.generateSessionId();
      sessionManager.setCurrentSessionId(id);
    }

    sessionManager.startAutoSave(
      () => chat.getHistory(),
      () => ({
        modelUsed: context.services.config?.getModel(),
      }),
    );

    return {
      type: 'message',
      messageType: 'info',
      content: 'Auto-save enabled. Sessions will be saved automatically every minute.',
    };
  } else if (arg === 'off') {
    sessionManager.stopAutoSave();
    return {
      type: 'message',
      messageType: 'info',
      content: 'Auto-save disabled.',
    };
  } else {
    const status = sessionManager.isAutoSaveActive() ? 'enabled' : 'disabled';
    return {
      type: 'message',
      messageType: 'info',
      content: `Auto-save is currently ${status}.\nUse \u001b[36m/session auto on\u001b[0m to enable or \u001b[36m/session auto off\u001b[0m to disable.`,
    };
  }
}

/**
 * Completion handler for session resume/delete/rename.
 */
async function sessionCompletion(
  context: CommandContext,
  partialArg: string,
): Promise<string[]> {
  const sessionManager = getSessionManager(context);
  if (!sessionManager) return [];

  try {
    return sessionManager.getCompletionSuggestions(partialArg);
  } catch {
    return [];
  }
}

/**
 * The /session command with subcommands.
 */
export const sessionCommand: SlashCommand = {
  name: 'session',
  description: 'Manage conversation sessions',
  subCommands: [
    {
      name: 'save',
      description: 'Save the current session. Usage: /session save [name]',
      action: saveSessionAction,
    },
    {
      name: 'list',
      description: 'List saved sessions. Usage: /session list [--all]',
      action: listSessionsAction,
    },
    {
      name: 'resume',
      description: 'Resume a saved session. Usage: /session resume <id|name>',
      action: resumeSessionAction,
      completion: sessionCompletion,
    },
    {
      name: 'delete',
      description: 'Delete a saved session. Usage: /session delete <id|name>',
      action: deleteSessionAction,
      completion: sessionCompletion,
    },
    {
      name: 'rename',
      description: 'Rename a session. Usage: /session rename <id|name> <new-name>',
      action: renameSessionAction,
      completion: sessionCompletion,
    },
    {
      name: 'auto',
      description: 'Toggle auto-save. Usage: /session auto [on|off]',
      action: autoSessionAction,
    },
  ],
};