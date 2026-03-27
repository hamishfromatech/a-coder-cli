/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config } from '@a-coder/core';
import { SlashCommand, SlashCommandActionReturn, type CommandContext, CommandCategory } from './types.js';

export const reloadSkillsCommand: SlashCommand = {
  name: 'reload-skills',
  description: 'Reload skills and plugins from disk',
  category: 'advanced' as CommandCategory,
  keywords: ['reload', 'refresh', 'skills', 'plugins', 'update'],
  examples: ['/reload-skills'],
  action: async (context: CommandContext, _args: string): Promise<SlashCommandActionReturn> => {
    const { config } = context.services;

    if (!config) {
      return {
        type: 'message',
        messageType: 'error',
        content: 'Config not available',
      };
    }

    try {
      // Get the command service from the context
      const { CommandService } = await import('../../services/CommandService.js');

      // Create a new instance and reload
      const commandService = new CommandService();
      const currentPath = config.getProjectRoot() || process.cwd();

      await commandService.reloadSkills(config, currentPath);

      return {
        type: 'message',
        messageType: 'info',
        content: 'Skills and plugins reloaded successfully from all directories.',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to reload skills and plugins: ${errorMessage}`,
      };
    }
  },
};