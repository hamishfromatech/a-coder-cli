/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Text, Box } from 'ink';
import { Colors, Semantic } from '../../colors.js';

interface ErrorMessageProps {
  text: string;
}

export const ErrorMessage: React.FC<ErrorMessageProps> = ({ text }) => {
  const prefix = '✕ ';
  const prefixWidth = prefix.length;

  return (
    <Box
      borderStyle="round"
      borderColor={Semantic.Error}
      flexDirection="row"
      paddingX={1}
      marginY={1}
    >
      <Box width={prefixWidth}>
        <Text color={Semantic.Error} bold>{prefix}</Text>
      </Box>
      <Box flexGrow={1}>
        <Text wrap="wrap" color={Semantic.Error}>
          {text}
        </Text>
      </Box>
    </Box>
  );
};
