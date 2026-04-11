/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SlashCommand, CommandCategory } from './types.js';

export const compactCommand: SlashCommand = {
  name: 'compact',
  altName: 'compress',
  description: 'Compress conversation history to free up context window space',
  category: 'general' as CommandCategory,
  keywords: ['compact', 'compress', 'context', 'memory', 'summarize'],
  action: async (context) => {
    const client = context.services.config?.getGeminiClient();
    if (!client) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'No chat client available.',
      };
    }

    try {
      const sessionId = context.services.config?.getSessionId() || '';
      const result = await client.tryCompressChat(sessionId, true);
      if (result) {
        return {
          type: 'message',
          messageType: 'info',
          content: `Conversation compressed.\n\n  Before: ${formatTokens(result.originalTokenCount)} tokens\n  After:  ${formatTokens(result.newTokenCount)} tokens\n  Saved:   ${formatTokens(result.originalTokenCount - result.newTokenCount)} tokens (${((1 - result.newTokenCount / result.originalTokenCount) * 100).toFixed(0)}% reduction)`,
        };
      } else {
        return {
          type: 'message',
          messageType: 'info',
          content: 'Conversation is already compact or compression is not available.',
        };
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        type: 'message',
        messageType: 'error',
        content: `Compression failed: ${errorMessage}`,
      };
    }
  },
};

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`;
  return String(tokens);
}
