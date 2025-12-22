/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SettingScope } from '../../config/settings.js';
import { OpenDialogActionReturn, SlashCommand } from './types.js';

export const authCommand: SlashCommand = {
  name: 'auth',
  description: 'change the auth method',
  action: (context, _args): OpenDialogActionReturn => {
    context.services.settings.setValue(
      SettingScope.User,
      'selectedAuthType',
      undefined,
    );
    return {
      type: 'dialog',
      dialog: 'auth',
    };
  },
};
