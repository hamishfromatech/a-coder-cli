/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getSkillsDir } from '@a-coder/core';
import open from 'open';
import { MessageType } from '../types.js';
import { SlashCommand, SlashCommandActionReturn } from './types.js';

export const skillsCommand: SlashCommand = {
  name: 'skills',
  description: 'List and load available skills.',
  action: (context, args): SlashCommandActionReturn | void => {
    if (!args || args.trim() === '') {
      return {
        type: 'dialog',
        dialog: 'skills',
      };
    }
  },
  subCommands: [
    {
      name: 'open',
      description: 'Open the skills directory in the default file explorer.',
      action: (context): SlashCommandActionReturn | void => {
        const skillsDir = getSkillsDir();
        context.ui.addItem(
          {
            type: MessageType.INFO,
            text: `Opening skills directory: ${skillsDir}`,
          },
          Date.now(),
        );

        open(skillsDir);
      },
    },
    {
      name: 'list',
      description: 'List all available skills.',
      action: (context): SlashCommandActionReturn | void => {
        context.ui.addItem(
          {
            type: MessageType.INFO,
            text: 'Listing available skills...',
          },
          Date.now(),
        );

        return {
          type: 'tool',
          toolName: 'skills',
          toolArgs: { action: 'list' },
        };
      },
    },
    {
      name: 'load',
      description: 'Load a skill by name.',
      action: (context, args): SlashCommandActionReturn | void => {
        if (!args || args.trim() === '') {
          return {
            type: 'message',
            messageType: 'error',
            content: 'Usage: /skills load <skill_name>',
          };
        }

        context.ui.addItem(
          {
            type: MessageType.INFO,
            text: `Loading skill: ${args.trim()}...`,
          },
          Date.now(),
        );

        return {
          type: 'tool',
          toolName: 'skills',
          toolArgs: { action: 'load', skill_name: args.trim() },
        };
      },
    },
  ],
};