/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Text, Box } from 'ink';
import { Semantic } from '../../colors.js';
import { Icons } from '../../utils/icons.js';
import { CONTENT } from '../../constants.js';

interface ErrorMessageProps {
  text: string;
  verbose?: boolean;
}

function truncateError(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

export const ErrorMessage: React.FC<ErrorMessageProps> = ({ text, verbose }) => {
  const maxLen = verbose ? CONTENT.maxVerboseErrorLength : CONTENT.maxErrorLength;
  const displayText = truncateError(text, maxLen);

  return (
    <Box
      flexDirection="column"
      marginY={1}
      borderStyle="single"
      borderLeft={true}
      borderRight={false}
      borderTop={false}
      borderBottom={false}
      borderColor={Semantic.Error}
      paddingX={1}
    >
      <Box flexDirection="row">
        <Box paddingRight={1}>
          <Text bold color={Semantic.Error}>{Icons.ErrorLabel}</Text>
        </Box>
        <Box flexGrow={1}>
          <Text wrap="wrap" color={Semantic.Error}>
            {displayText}
          </Text>
        </Box>
      </Box>
    </Box>
  );
};