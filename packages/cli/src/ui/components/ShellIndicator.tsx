/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState } from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { BackgroundShell } from '../types.js';

interface ShellIndicatorProps {
  shells: BackgroundShell[];
  isFocused: boolean;
  onSelectShell: (shellId: string) => void;
}

export const ShellIndicator: React.FC<ShellIndicatorProps> = ({
  shells,
  isFocused,
  onSelectShell,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  if (shells.length === 0) {
    return null;
  }

  const runningCount = shells.filter((s) => s.status === 'running').length;
  const completedCount = shells.filter((s) => s.status === 'completed').length;
  const killedCount = shells.filter((s) => s.status === 'killed').length;

  const getStatusColor = (status: BackgroundShell['status']) => {
    switch (status) {
      case 'running':
        return Colors.AccentGreen;
      case 'completed':
        return Colors.Gray;
      case 'killed':
        return Colors.AccentRed;
    }
  };

  const getStatusLabel = (status: BackgroundShell['status']) => {
    switch (status) {
      case 'running':
        return 'running';
      case 'completed':
        return 'done';
      case 'killed':
        return 'killed';
    }
  };

  // Show single line when not focused
  if (!isFocused) {
    return (
      <Box>
        <Text color={Colors.AccentYellow}>
          {runningCount > 0 ? (
            <>
              <Text bold>{shells.length}</Text>
              <Text dimColor> shell{shells.length !== 1 ? 's' : ''}</Text>
            </>
          ) : (
            <Text dimColor>
              {completedCount} shell{completedCount !== 1 ? 's' : ''} (done)
            </Text>
          )}
        </Text>
        {isFocused && (
          <Text dimColor> ↓</Text>
        )}
      </Box>
    );
  }

  // Show detailed list when focused
  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text color={Colors.AccentYellow} bold>
          {shells.length} shell{shells.length !== 1 ? 's' : ''}
        </Text>
        <Text dimColor> (↑↓ navigate, Enter select, Esc back)</Text>
      </Box>
      {shells.map((shell, index) => (
        <Box
          key={shell.id}
          paddingX={1}
          {...(selectedIndex === index ? { borderStyle: 'bold', borderColor: Colors.AccentCyan } : {})}
        >
          <Text
            color={selectedIndex === index ? Colors.AccentCyan : undefined}
          >
            {selectedIndex === index ? '▶ ' : '  '}
          </Text>
          <Text dimColor>#{index + 1}</Text>
          <Text color={Colors.Gray}> $ </Text>
          <Text
            color={selectedIndex === index ? Colors.AccentCyan : undefined}
            italic
          >
            {shell.command.length > 50
              ? shell.command.slice(0, 47) + '...'
              : shell.command}
          </Text>
          <Text color={getStatusColor(shell.status)}>
            {' '}
            [{getStatusLabel(shell.status)}]
          </Text>
          {shell.status === 'completed' && shell.exitCode !== null && (
            <Text dimColor> (exit: {shell.exitCode})</Text>
          )}
        </Box>
      ))}
    </Box>
  );
};
