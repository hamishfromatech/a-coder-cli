/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Semantic } from '../colors.js';
import { ApprovalMode } from '@a-coder/core';

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
  approvalMode?: ApprovalMode;
}

/**
 * Get a short label for the approval mode.
 */
function getApprovalModeLabel(mode?: ApprovalMode): string {
  switch (mode) {
    case ApprovalMode.AUTO_EDIT:
      return 'auto-edit';
    case ApprovalMode.YOLO:
      return 'yolo';
    default:
      return '';
  }
}

/**
 * Get color for context usage percentage.
 */
function getContextColor(percentage: number): string {
  if (percentage >= 0.9) return Semantic.Error;
  if (percentage >= 0.7) return Semantic.Warning;
  return Semantic.Muted;
}

/**
 * Compact status line modeled after Claude Code's approach.
 * Single-line layout: model · mode | context%
 */
export const Footer: React.FC<FooterProps> = ({
  model,
  branchName,
  debugMode,
  debugMessage,
  corgiMode,
  errorCount,
  showErrorDetails,
  promptTokenCount,
  contextUsage,
  approvalMode,
  terminalWidth,
}) => {
  const modeLabel = getApprovalModeLabel(approvalMode);
  const currentTokens = contextUsage?.tokens ?? promptTokenCount;
  const percentage = contextUsage?.percentage ?? 0;
  const contextColor = getContextColor(percentage);

  // Build the left side: model name + mode badge
  const leftParts: React.ReactNode[] = [];
  leftParts.push(
    <Text key="model" color={Semantic.Primary} bold>
      {model}
    </Text>
  );

  if (modeLabel) {
    leftParts.push(
      <Text key="mode-sep" color={Semantic.Muted}> · </Text>
    );
    leftParts.push(
      <Text key="mode" color={approvalMode === ApprovalMode.YOLO ? Semantic.Error : Semantic.Success} bold>
        {modeLabel}
        {approvalMode === ApprovalMode.YOLO ? '!' : ''}
      </Text>
    );
  }

  if (branchName) {
    leftParts.push(
      <Text key="branch-sep" color={Semantic.Muted}> · </Text>
    );
    leftParts.push(
      <Text key="branch" color={Semantic.Muted} dimColor>
        {branchName}
      </Text>
    );
  }

  // Build the right side: context usage percentage
  const rightContent = (
    <Text color={contextColor} dimColor>
      {percentage > 0 ? `${(percentage * 100).toFixed(0)}%` : ''}
    </Text>
  );

  return (
    <Box
      marginTop={1}
      paddingTop={1}
      justifyContent="space-between"
      width="100%"
    >
      {/* Left: Model + mode + branch */}
      <Box flexShrink={1} alignItems="center">
        {leftParts}
      </Box>

      {/* Right: Context usage */}
      <Box alignItems="center" flexShrink={0}>
        {contextUsage && percentage > 0 && rightContent}
        {!showErrorDetails && errorCount > 0 && (
          <Text color={Semantic.Error} dimColor>
            {' '}({errorCount} error{errorCount !== 1 ? 's' : ''})
          </Text>
        )}
        {debugMode && (
          <Text color={Semantic.Error} dimColor>
            {' '}{debugMessage || '--debug'}
          </Text>
        )}
      </Box>
    </Box>
  );
};