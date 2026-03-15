/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Text, Box } from 'ink';
import { Colors, Semantic } from '../../colors.js';

interface InfoMessageProps {
  text: string;
}

export const InfoMessage: React.FC<InfoMessageProps> = ({ text }) => {
  return (
    <Box
      flexDirection="row"
      marginY={1}
      borderStyle="single"
      borderColor={Semantic.Info}
      paddingX={1}
    >
      <Box paddingRight={1}>
        <Text bold color={Semantic.Info}>[INFO]</Text>
      </Box>
      <Box flexGrow={1}>
        <Text wrap="wrap" color={Colors.Foreground}>
          {text}
        </Text>
      </Box>
    </Box>
  );
};
