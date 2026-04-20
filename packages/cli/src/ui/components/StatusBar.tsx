/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { ContextSummaryDisplay } from './ContextSummaryDisplay.js';
import { AutoAcceptIndicator } from './AutoAcceptIndicator.js';
import { ShellModeIndicator } from './ShellModeIndicator.js';
import { ShellIndicator } from './ShellIndicator.js';
import { ApprovalMode, type Config } from '@a-coder/core';
import type { BackgroundShell, FocusMode } from '../types.js';

interface StatusBarProps {
  ctrlCPressedOnce: boolean;
  ctrlDPressedOnce: boolean;
  geminiMdFileCount: number;
  contextFileNames: string[];
  config: Config;
  showToolDescriptions: boolean;
  showAutoAcceptIndicator: ApprovalMode;
  shellModeActive: boolean;
  backgroundShells: BackgroundShell[];
  focusMode: FocusMode;
  onSelectShell: (id: string) => void;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  ctrlCPressedOnce,
  ctrlDPressedOnce,
  geminiMdFileCount,
  contextFileNames,
  config,
  showToolDescriptions,
  showAutoAcceptIndicator,
  shellModeActive,
  backgroundShells,
  focusMode,
  onSelectShell,
}) => (
  <Box
    marginTop={0}
    display="flex"
    justifyContent="space-between"
    width="100%"
  >
    <Box>
      {process.env.GEMINI_SYSTEM_MD && (
        <Text color={Colors.AccentRed}>|⌐■_■| </Text>
      )}
      {ctrlCPressedOnce ? (
        <Text color={Colors.AccentYellow}>
          Press Ctrl+C again to exit.
        </Text>
      ) : ctrlDPressedOnce ? (
        <Text color={Colors.AccentYellow}>
          Press Ctrl+D again to exit.
        </Text>
      ) : (
        <ContextSummaryDisplay
          geminiMdFileCount={geminiMdFileCount}
          contextFileNames={contextFileNames}
          mcpServers={config.getMcpServers()}
          showToolDescriptions={showToolDescriptions}
        />
      )}
    </Box>
    <Box>
      {showAutoAcceptIndicator !== ApprovalMode.DEFAULT &&
        !shellModeActive && (
          <AutoAcceptIndicator
            approvalMode={showAutoAcceptIndicator}
          />
        )}
      {shellModeActive && <ShellModeIndicator />}
      {backgroundShells.length > 0 && (
        <ShellIndicator
          shells={backgroundShells}
          isFocused={focusMode === 'shell-list'}
          onSelectShell={onSelectShell}
        />
      )}
    </Box>
  </Box>
);
