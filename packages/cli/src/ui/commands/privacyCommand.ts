/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { OpenDialogActionReturn, SlashCommand, CommandCategory } from './types.js';

export const privacyCommand: SlashCommand = {
  name: 'privacy',
  description: 'Display the privacy notice',
  category: 'general' as CommandCategory,
  keywords: ['privacy', 'notice', 'data', 'policy'],
  action: (): OpenDialogActionReturn => ({
    type: 'dialog',
    dialog: 'privacy',
  }),
};
