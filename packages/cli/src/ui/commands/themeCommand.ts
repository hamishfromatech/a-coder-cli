/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OpenDialogActionReturn, SlashCommand, CommandCategory } from './types.js';

export const themeCommand: SlashCommand = {
  name: 'theme',
  description: 'Change color theme',
  category: 'config' as CommandCategory,
  keywords: ['theme', 'color', 'style', 'appearance', 'dark', 'light'],
  action: (_context, _args): OpenDialogActionReturn => ({
    type: 'dialog',
    dialog: 'theme',
  }),
};
