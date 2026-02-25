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
  const prefix = 'ℹ ';
  const prefixWidth = prefix.length;

  return (
    <Box
      flexDirection="row"
      marginY={1}
      borderStyle="round"
      borderColor={Semantic.Info}
      paddingX={1}
    >
      <Box width={prefixWidth}>
        <Text color={Semantic.Info} bold>{prefix}</Text>
      </Box>
      <Box flexGrow={1}>
        <Text wrap="wrap" color={Colors.Foreground}>
          {text}
        </Text>
      </Box>
    </Box>
  );
};
