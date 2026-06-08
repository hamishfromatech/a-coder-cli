import React from 'react';
import { Box, Text } from 'ink';
import { Colors, Semantic, contrastText } from '../colors.js';
import { ContextSummaryDisplay } from './ContextSummaryDisplay.js';
import { AutoAcceptIndicator } from './AutoAcceptIndicator.js';
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
    marginBottom={1}
    justifyContent="space-between"
    width="100%"
  >
    <Box flexDirection="row" gap={1} alignItems="center">
      {process.env.GEMINI_SYSTEM_MD && (
        <Text color={Colors.AccentRed}>|⌐■_■|</Text>
      )}
      {ctrlCPressedOnce ? (
        <Box
          backgroundColor={Semantic.Warning}
          paddingX={1}
        >
          <Text color={contrastText(Semantic.Warning)} bold>Ctrl+C again to exit</Text>
        </Box>
      ) : ctrlDPressedOnce ? (
        <Box
          backgroundColor={Semantic.Warning}
          paddingX={1}
        >
          <Text color={contrastText(Semantic.Warning)} bold>Ctrl+D again to exit</Text>
        </Box>
      ) : (
        <ContextSummaryDisplay
          geminiMdFileCount={geminiMdFileCount}
          contextFileNames={contextFileNames}
          mcpServers={config.getMcpServers()}
          showToolDescriptions={showToolDescriptions}
        />
      )}
    </Box>
    <Box flexDirection="row" gap={1} alignItems="center">
      {showAutoAcceptIndicator !== ApprovalMode.DEFAULT && !shellModeActive && (
        <AutoAcceptIndicator approvalMode={showAutoAcceptIndicator} />
      )}
      {shellModeActive && (
        <Box backgroundColor={Semantic.Warning} paddingX={1}>
          <Text color={contrastText(Semantic.Warning)} bold>!</Text>
        </Box>
      )}
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