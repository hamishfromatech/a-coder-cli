/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors, Semantic } from '../colors.js';
import { type Config } from '@a-coder/core';

interface TipsProps {
  config: Config;
}

export const Tips: React.FC<TipsProps> = ({ config }) => {
  const geminiMdFileCount = config.getGeminiMdFileCount();
  return (
    <Box flexDirection="column" marginBottom={1} paddingX={0}>
      <Text color={Semantic.Muted} dimColor>
        Ask questions, edit files, or run commands. Be specific for best results.
      </Text>
      {geminiMdFileCount === 0 && (
        <Text color={Semantic.Muted} dimColor>
          Create{' '}
          <Text bold color={Colors.AccentPurple} dimColor={false}>
            A-CODER.md
          </Text>{' '}
          files to customize interactions.
        </Text>
      )}
      <Text color={Semantic.Muted} dimColor>
        Type{' '}
        <Text bold color={Colors.AccentPurple} dimColor={false}>
          ?
        </Text>{' '}
        or{' '}
        <Text bold color={Colors.AccentPurple} dimColor={false}>
          /help
        </Text>{' '}
        for commands and shortcuts.
      </Text>
    </Box>
  );
};
