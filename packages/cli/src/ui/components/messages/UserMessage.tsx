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
  pastedInfo?: {
    pasteId: number;
    lineCount: number;
  };
}

export const UserMessage: React.FC<UserMessageProps> = ({ text, pastedInfo }) => {
  // If this was pasted content, show a collapsed view
  if (pastedInfo) {
    const { pasteId, lineCount } = pastedInfo;
    const extraLines = lineCount > 1 ? ` +${lineCount - 1} lines` : '';

    return (
      <Box
        paddingX={1}
        marginY={1}
      >
        <Text color={Semantic.Muted}>
          [Pasted text #{pasteId}{extraLines}]
        </Text>
      </Box>
    );
  }

  // Normal message display — no bracket prefix, clean text
  return (
    <Box
      paddingX={1}
      marginY={1}
    >
      <Text wrap="wrap" color={Colors.Foreground}>
        {text}
      </Text>
    </Box>
  );
};