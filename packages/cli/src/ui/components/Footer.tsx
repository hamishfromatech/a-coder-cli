/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Semantic } from '../colors.js';
import {
  shortenPath,
  tildeifyPath,
  tokenLimit,
} from '@a-coder/core';
import { ConsoleSummaryDisplay } from './ConsoleSummaryDisplay.js';
import process from 'node:process';
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
    <Box
      marginTop={1}
      paddingTop={1}
      justifyContent="space-between"
      width="100%"
    >
      {/* Left: Path and git branch */}
      <Box flexShrink={1} flexDirection="column">
        <Box>
          <Text color={Semantic.Info} wrap="truncate">
            {shortenPath(tildeifyPath(targetDir), pathLimit)}
          </Text>
          {branchName && (
            <Text color={Semantic.Info} dimColor>
              {' '}
              ({branchName}*)
            </Text>
          )}
        </Box>
        {debugMode && (
          <Text color={Semantic.Error} dimColor>
            {debugMessage || '--debug'}
          </Text>
        )}
      </Box>

      {/* Middle: Sandbox status */}
      <Box
        flexGrow={1}
        alignItems="center"
        justifyContent="center"
        display="flex"
        flexDirection="column"
      >
        {process.env.SANDBOX && process.env.SANDBOX !== 'sandbox-exec' ? (
          <Text color={Semantic.Success}>
            {process.env.SANDBOX.replace(/^gemini-(?:cli-)?/, '')}
          </Text>
        ) : process.env.SANDBOX === 'sandbox-exec' ? (
          <>
            <Text color={Semantic.Warning}>
              MacOS Seatbelt
            </Text>
            <Text color={Semantic.Warning} dimColor>
              {process.env.SEATBELT_PROFILE}
            </Text>
          </>
        ) : (
          <>
            <Text color={Semantic.Error} dimColor>
              no sandbox
            </Text>
            <Text color={Semantic.Error} dimColor>
              use /help for info
            </Text>
          </>
        )}
      </Box>

      {/* Right: Model and context usage */}
      <Box alignItems="flex-end" flexShrink={1} flexDirection="column">
        <Text color={getColorForPercentage(percentage)} wrap="truncate">
          {model}
        </Text>
        <Text color={getColorForPercentage(percentage)} dimColor wrap="truncate">
          {(percentage * 100).toFixed(0)}% context used
        </Text>
        {!showErrorDetails && errorCount > 0 && (
          <Box>
            <ConsoleSummaryDisplay errorCount={errorCount} />
          </Box>
        )}
        {showMemoryUsage && <MemoryUsageDisplay />}
      </Box>
    </Box>
  );
};
