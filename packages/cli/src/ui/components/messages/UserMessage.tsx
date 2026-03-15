/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Text, Box } from 'ink';
import { Colors, Semantic } from '../../colors.js';

interface UserMessageProps {
  text: string;
}

export const UserMessage: React.FC<UserMessageProps> = ({ text }) => {
  return (
    <Box
      flexDirection="row"
      paddingX={1}
      marginY={1}
      alignSelf="flex-start"
    >
      <Box paddingRight={1}>
        <Text bold>[YOU]</Text>
      </Box>
      <Box flexGrow={1}>
        <Text wrap="wrap" color={Colors.Foreground}>
          {text}
        </Text>
      </Box>
    </Box>
  );
};
