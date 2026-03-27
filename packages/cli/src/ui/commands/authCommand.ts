/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SettingScope } from '../../config/settings.js';
import { OpenDialogActionReturn, SlashCommand, CommandCategory } from './types.js';

export const authCommand: SlashCommand = {
  name: 'auth',
  description: 'Change authentication method',
  category: 'config' as CommandCategory,
  keywords: ['auth', 'login', 'authentication', 'api key', 'credentials'],
  action: (context, _args): OpenDialogActionReturn => {
    return {
      type: 'dialog',
      dialog: 'auth',
    };
  },
};
