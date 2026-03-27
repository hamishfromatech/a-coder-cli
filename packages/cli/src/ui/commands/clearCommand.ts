/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SlashCommand, CommandCategory } from './types.js';

export const clearCommand: SlashCommand = {
  name: 'clear',
  description: 'Clear screen and conversation history',
  category: 'general' as CommandCategory,
  keywords: ['clear', 'reset', 'clean', 'wipe'],
  action: async (context, _args) => {
    context.ui.setDebugMessage('Clearing terminal and resetting chat.');
    await context.services.config?.getGeminiClient()?.resetChat();
    context.ui.clear();
  },
};
