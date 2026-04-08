/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors, Semantic } from '../colors.js';
import { BackgroundShell } from '../types.js';

interface ShellOutputViewerProps {
  shell: BackgroundShell;
  shellIndex: number;
  onKill: () => void;
  onBack: () => void;
  terminalWidth: number;
}

export const ShellOutputViewer: React.FC<ShellOutputViewerProps> = ({
  shell,
  shellIndex,
  onKill,
  onBack,
  terminalWidth,
}) => {
  const getStatusColor = () => {
    switch (shell.status) {
      case 'running':
        return Colors.AccentGreen;
      case 'completed':
        return Colors.Gray;
      case 'killed':
        return Colors.AccentRed;
    }
  };

  const getStatusLabel = () => {
    switch (shell.status) {
      case 'running':
        return 'running';
      case 'completed':
        return `done (exit: ${shell.exitCode ?? 0})`;
      case 'killed':
        return 'killed';
    }
  };

  return (
    <Box flexDirection="column" marginY={1}>
      {/* Header */}
      <Box
        borderStyle="round"
        borderColor={Colors.AccentCyan}
        paddingX={1}
        paddingY={0}
        flexDirection="column"
      >
        <Box>
          <Text color={Colors.AccentCyan} bold>
            Shell #{shellIndex + 1}
          </Text>
          <Text color={Colors.Gray}> $ </Text>
          <Text italic>{shell.command}</Text>
          <Text color={getStatusColor()}> [{getStatusLabel()}]</Text>
        </Box>
      </Box>

      {/* Output */}
      <Box
        flexDirection="column"
        borderStyle="single"
        borderColor={Colors.Gray}
        paddingX={1}
        paddingY={0}
        marginY={0}
      >
        {shell.output.length === 0 ? (
          <Text dimColor italic>
            {shell.status === 'running'
              ? 'Waiting for output...'
              : '(No output)'}
          </Text>
        ) : (
          <Text wrap="wrap" color={Colors.Foreground}>
            {shell.output}
          </Text>
        )}
        {shell.status === 'running' && (
          <Text dimColor>
            {shell.output.length > 0 ? '\n' : ''}
            <Text dimColor>Streaming...</Text>
          </Text>
        )}
      </Box>

      {/* Footer */}
      <Box marginTop={1}>
        {shell.status === 'running' ? (
          <>
            <Text
              color={Colors.AccentRed}
              backgroundColor={Colors.Background}
              bold
            >
              [x] kill
            </Text>
            <Text dimColor> | </Text>
          </>
        ) : null}
        <Text color={Colors.Gray}>
          [enter/backspace] return to input
        </Text>
      </Box>
    </Box>
  );
};
