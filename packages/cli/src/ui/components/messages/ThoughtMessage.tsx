/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../../colors.js';

interface ThoughtMessageProps {
  text: string;
  isComplete: boolean;
}

export const ThoughtMessage: React.FC<ThoughtMessageProps> = ({
  text,
  isComplete,
}) => {
  return (
    <Box flexDirection="column" marginTop={0} marginBottom={0}>
      <Box>
        <Text color={Colors.AccentPurple}>Thinking</Text>
        <Text color={Colors.Gray}>
          {isComplete ? '' : '...'}
        </Text>
      </Box>
      {text && (
        <Box paddingLeft={2} marginTop={0}>
          <Text color={Colors.Gray} wrap="wrap">
            {text}
          </Text>
        </Box>
      )}
    </Box>
  );
};
