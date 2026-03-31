/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Text, Box } from 'ink';
import { Semantic } from '../../colors.js';
import { Icons } from '../../utils/icons.js';

interface ErrorMessageProps {
  text: string;
}

export const ErrorMessage: React.FC<ErrorMessageProps> = ({ text }) => {
  return (
    <Box
      borderStyle="single"
      borderColor={Semantic.Error}
      flexDirection="row"
      paddingX={1}
      marginY={1}
    >
      <Box paddingRight={1}>
        <Text bold color={Semantic.Error}>{Icons.ErrorLabel}</Text>
      </Box>
      <Box flexGrow={1}>
        <Text wrap="wrap" color={Semantic.Error}>
          {text}
        </Text>
      </Box>
    </Box>
  );
};