/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from 'ink';
import { Colors, Semantic } from '../colors.js';
import { Icons } from '../utils/icons.js';

interface UpdateNotificationProps {
  message: string;
}

export const UpdateNotification = ({ message }: UpdateNotificationProps) => (
  <Box
    borderStyle="single"
    borderColor={Semantic.Warning}
    paddingX={1}
    marginY={1}
    flexDirection="row"
  >
    <Box paddingRight={1}>
      <Text bold color={Semantic.Warning}>{Icons.UpdateLabel}</Text>
    </Box>
    <Box flexGrow={1}>
      <Text wrap="wrap" color={Colors.Foreground}>{message}</Text>
    </Box>
  </Box>
);