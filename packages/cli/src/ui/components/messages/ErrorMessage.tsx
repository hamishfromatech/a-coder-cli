/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Text, Box } from 'ink';
import { Semantic } from '../../colors.js';
import { Icons } from '../../utils/icons.js';

/** Maximum characters to display for error messages in normal mode. */
const MAX_ERROR_DISPLAY_LENGTH = 1000;

/** Maximum characters for error messages when debug/verbose mode is on. */
const MAX_VERBOSE_ERROR_DISPLAY_LENGTH = 10000;

interface ErrorMessageProps {
  text: string;
  verbose?: boolean;
}

function truncateError(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

export const ErrorMessage: React.FC<ErrorMessageProps> = ({ text, verbose }) => {
  const maxLen = verbose ? MAX_VERBOSE_ERROR_DISPLAY_LENGTH : MAX_ERROR_DISPLAY_LENGTH;
  const displayText = truncateError(text, maxLen);

  return (
    <Box
      flexDirection="row"
      paddingX={1}
      marginY={1}
    >
      <Box paddingRight={1}>
        <Text bold color={Semantic.Error}>{Icons.ErrorLabel}</Text>
      </Box>
      <Box flexGrow={1}>
        <Text wrap="wrap" color={Semantic.Error}>
          {displayText}
        </Text>
      </Box>
    </Box>
  );
};