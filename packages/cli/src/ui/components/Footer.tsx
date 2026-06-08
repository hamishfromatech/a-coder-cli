import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { Semantic } from '../colors.js';
import { ApprovalMode } from '@a-coder/core';
import { Divider } from './shared/Divider.js';

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
  footerStyle?: 'compact' | 'detailed' | 'minimal';
  highContrast?: boolean;
}

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

function getContextColor(percentage: number): string {
  if (percentage >= 0.9) return Semantic.Error;
  if (percentage >= 0.7) return Semantic.Warning;
  return Semantic.Muted;
}

function ContextProgressBar({ percentage, width = 10 }: { percentage: number; width?: number }) {
  const filled = Math.round(percentage * width);
  const empty = width - filled;
  const color = getContextColor(percentage);
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return (
    <Text color={color} dimColor>
      {bar} {(percentage * 100).toFixed(0)}%
    </Text>
  );
}

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
  footerStyle = 'detailed',
  highContrast = false,
}) => {
  const modeLabel = getApprovalModeLabel(approvalMode);
  const currentTokens = contextUsage?.tokens ?? promptTokenCount;
  const percentage = contextUsage?.percentage ?? 0;
  const contextColor = getContextColor(percentage);

  const leftParts: React.ReactNode[] = [];
  leftParts.push(
    <Text key="model" color={Semantic.Primary} bold={highContrast}>
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
      <Text key="branch" color={Semantic.Muted} dimColor={!highContrast}>
        {branchName}
      </Text>
    );
  }

  const leftSide = (
    <Box flexShrink={1} alignItems="center">
      {leftParts}
    </Box>
  );

  if (footerStyle === 'minimal') {
    return (
      <Box flexDirection="column" width="100%">
        <Divider width={terminalWidth} marginTop={0} marginBottom={0} />
        <Box marginTop={0} paddingTop={1} justifyContent="space-between" width="100%">
          {leftSide}
          <Box alignItems="center" flexShrink={0}>
            {percentage > 0 && (
              <Text color={contextColor} dimColor>
                {(percentage * 100).toFixed(0)}%
              </Text>
            )}
          </Box>
        </Box>
      </Box>
    );
  }

  if (footerStyle === 'compact') {
    return (
      <Box flexDirection="column" width="100%">
        <Divider width={terminalWidth} marginTop={0} marginBottom={0} />
        <Box marginTop={0} paddingTop={1} justifyContent="space-between" width="100%">
          {leftSide}
          <Box alignItems="center" flexShrink={0}>
            {percentage > 0 && <ContextProgressBar percentage={percentage} width={8} />}
            {!showErrorDetails && errorCount > 0 && (
              <Text color={Semantic.Error} dimColor bold={highContrast}>
                {' '}({errorCount})
              </Text>
            )}
            {debugMode && (
              <Text color={Semantic.Error} dimColor>
                {' '}{debugMessage || '--debug'}
              </Text>
            )}
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width="100%">
      <Divider width={terminalWidth} marginTop={0} marginBottom={0} />
      <Box marginTop={0} paddingTop={1} justifyContent="space-between" width="100%">
        {leftSide}
        <Box alignItems="center" flexShrink={0}>
          {contextUsage && percentage > 0 && (
            <ContextProgressBar percentage={percentage} width={10} />
          )}
          {!showErrorDetails && errorCount > 0 && (
            <Text color={Semantic.Error} dimColor bold={highContrast}>
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
    </Box>
  );
};