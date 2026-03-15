/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config } from '@a-coder/core';
import { SlashCommand, SlashCommandActionReturn, type CommandContext } from './types.js';

export const reloadSkillsCommand: SlashCommand = {
  name: 'reload-skills',
  description: 'Reload skills from all skill directories (useful after adding/modifying skills)',
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
        content: 'Skills reloaded successfully from all skill directories.',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        type: 'message',
        messageType: 'error',
        content: `Failed to reload skills: ${errorMessage}`,
      };
    }
  },
};