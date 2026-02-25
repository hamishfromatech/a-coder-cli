/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors, Semantic } from '../colors.js';
import {
  shortenPath,
  tildeifyPath,
  tokenLimit,
} from '@a-coder/core';
import { ConsoleSummaryDisplay } from './ConsoleSummaryDisplay.js';
import process from 'node:process';
import Gradient from 'ink-gradient';
import { MemoryUsageDisplay } from './MemoryUsageDisplay.js';

interface ContextUsageInfo {
  tokens: number;
  limit: number;
  percentage: number;
}

interface FooterProps {
  model: string;
  targetDir: string;
  branchName?: string;
  debugMode: boolean;
  debugMessage: string;
  corgiMode: boolean;
  errorCount: number;
  showErrorDetails: boolean;
  showMemoryUsage?: boolean;
  promptTokenCount: number;
  contextUsage?: ContextUsageInfo | null;
  nightly: boolean;
  terminalWidth: number;
}

export const Footer: React.FC<FooterProps> = ({
  model,
  targetDir,
  branchName,
  debugMode,
  debugMessage,
  corgiMode,
  errorCount,
  showErrorDetails,
  showMemoryUsage,
  promptTokenCount,
  contextUsage,
  nightly,
  terminalWidth,
}) => {
  const limit = tokenLimit(model);
  // Use contextUsage if available, otherwise fall back to promptTokenCount
  const currentTokens = contextUsage?.tokens ?? promptTokenCount;
  const percentage = currentTokens / limit;
  const pathLimit = Math.max(10, Math.floor(terminalWidth * 0.4));

  // Show warning color if approaching limit using semantic colors
  const getColorForPercentage = (p: number) => {
    if (p >= 0.9) return Semantic.Error;
    if (p >= 0.7) return Semantic.Warning;
    return Semantic.Info;
  };

  return (
    <Box marginTop={1} justifyContent="space-between" width="100%">
      <Box flexShrink={1}>
        {nightly ? (
          <Gradient colors={Colors.GradientColors}>
            <Text wrap="truncate">
              {shortenPath(tildeifyPath(targetDir), pathLimit)}
              {branchName && <Text> ({branchName}*)</Text>}
            </Text>
          </Gradient>
        ) : (
          <Text color={Semantic.Info} wrap="truncate">
            {shortenPath(tildeifyPath(targetDir), pathLimit)}
            {branchName && <Text color={Semantic.Muted}> ({branchName}*)</Text>}
          </Text>
        )}
        {debugMode && (
          <Text color={Semantic.Error}>
            {' ' + (debugMessage || '--debug')}
          </Text>
        )}
      </Box>

      {/* Middle Section: Centered Sandbox Info */}
      <Box
        flexGrow={1}
        alignItems="center"
        justifyContent="center"
        display="flex"
      >
        {process.env.SANDBOX && process.env.SANDBOX !== 'sandbox-exec' ? (
          <Text color={Semantic.Success}>
            {process.env.SANDBOX.replace(/^gemini-(?:cli-)?/, '')}
          </Text>
        ) : process.env.SANDBOX === 'sandbox-exec' ? (
          <Text color={Semantic.Warning}>
            MacOS Seatbelt{' '}
            <Text color={Semantic.Muted}>({process.env.SEATBELT_PROFILE})</Text>
          </Text>
        ) : (
          <Text color={Semantic.Error}>
            no sandbox <Text color={Semantic.Muted}>(see /docs)</Text>
          </Text>
        )}
      </Box>

      {/* Right Section: Gemini Label and Console Summary */}
      <Box alignItems="center" flexShrink={1}>
        <Text color={getColorForPercentage(percentage)} wrap="truncate">
          {' '}
          {model}{' '}
          <Text color={Semantic.Muted}>
            ({((1 - percentage) * 100).toFixed(0)}% context left)
          </Text>
        </Text>
        {corgiMode && (
          <Text>
            <Text color={Semantic.Muted}>| </Text>
            <Text color={Semantic.Error}>▼</Text>
            <Text color={Colors.Foreground}>(´</Text>
            <Text color={Semantic.Error}>ᴥ</Text>
            <Text color={Colors.Foreground}>`)</Text>
            <Text color={Semantic.Error}>▼ </Text>
          </Text>
        )}
        {!showErrorDetails && errorCount > 0 && (
          <Box>
            <Text color={Semantic.Muted}>| </Text>
            <ConsoleSummaryDisplay errorCount={errorCount} />
          </Box>
        )}
        {showMemoryUsage && <MemoryUsageDisplay />}
      </Box>
    </Box>
  );
};
