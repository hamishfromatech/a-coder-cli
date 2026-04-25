/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Semantic } from '../../colors.js';

interface UserShellMessageProps {
  text: string;
}

export const UserShellMessage: React.FC<UserShellMessageProps> = ({ text }) => {
  const commandToDisplay = text.startsWith('!') ? text.substring(1) : text;

  return (
    <Box marginY={1} paddingX={1}>
      <Text color={Semantic.Warning}>$ </Text>
      <Text>{commandToDisplay}</Text>
    </Box>
  );
};
