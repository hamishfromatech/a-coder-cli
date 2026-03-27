/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OpenDialogActionReturn, SlashCommand, CommandCategory } from './types.js';

export const helpCommand: SlashCommand = {
  name: 'help',
  altName: '?',
  description: 'Show help and available commands',
  category: 'general' as CommandCategory,
  keywords: ['help', 'commands', 'usage', 'guide'],
  action: (_context, _args): OpenDialogActionReturn => {
    console.debug('Opening help UI ...');
    return {
      type: 'dialog',
      dialog: 'help',
    };
  },
};
