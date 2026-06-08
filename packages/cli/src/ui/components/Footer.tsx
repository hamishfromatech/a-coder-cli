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

function getApprovalColor(mode?: ApprovalMode): string {
  switch (mode) {
    case ApprovalMode.YOLO: return Semantic.Error;
    case ApprovalMode.AUTO_EDIT: return Semantic.Success;
    default: return Semantic.Muted;
  }
}

function getApprovalLabel(mode?: ApprovalMode): string {
  switch (mode) {
    case ApprovalMode.AUTO_EDIT: return 'AE';
    case ApprovalMode.YOLO: return 'YO';
    default: return '';
  }
}

function ContextMiniBar({ percentage, width = 6 }: { percentage: number; width?: number }) {
  const filled = Math.round(percentage * width);
  const empty = width - filled;
  const color = percentage >= 0.9 ? Semantic.Error : percentage >= 0.7 ? Semantic.Warning : Semantic.Muted;
  const bar = '█'.repeat(filled) + '░'.repeat(empty);
  return (
    <Text color={color} dimColor>
      {bar}
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
  contextUsage,
  approvalMode,
  terminalWidth,
  footerStyle = 'detailed',
  highContrast = false,
}) => {
  const percentage = contextUsage?.percentage ?? 0;
  const approvalColor = getApprovalColor(approvalMode);
  const approvalLabel = getApprovalLabel(approvalMode);

  if (footerStyle === 'minimal') {
    return (
      <Box flexDirection="column" width="100%">
        <Divider width={terminalWidth} marginTop={0} marginBottom={0} />
        <Box paddingTop={1} justifyContent="space-between" width="100%">
          <Text bold={highContrast} color={Semantic.Primary}>{model}</Text>
          <Box>
            {percentage > 0 && (
              <Text color={percentage >= 0.9 ? Semantic.Error : Semantic.Muted} dimColor>
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
        <Box paddingTop={1} justifyContent="space-between" width="100%">
          <Box flexDirection="row" gap={1} alignItems="center">
            <Text bold color={Semantic.Primary}>{model}</Text>
            {branchName && <Text color={Semantic.Muted} dimColor>| {branchName}</Text>}
            {approvalLabel && (
              <Text color={approvalColor} bold>{approvalLabel}</Text>
            )}
          </Box>
          <Box flexDirection="row" gap={1} alignItems="center">
            {percentage > 0 && <ContextMiniBar percentage={percentage} width={6} />}
            {!showErrorDetails && errorCount > 0 && (
              <Text color={Semantic.Error} dimColor bold={highContrast}>
                !{errorCount}
              </Text>
            )}
            {debugMode && (
              <Text color={Semantic.Error} dimColor>DBG</Text>
            )}
          </Box>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width="100%">
      <Divider width={terminalWidth} marginTop={0} marginBottom={0} />
      <Box paddingTop={1} justifyContent="space-between" width="100%">
        <Box flexDirection="row" gap={2} alignItems="center">
          <Text bold color={Semantic.Primary}>{model}</Text>
          {approvalLabel && (
            <Text color={approvalColor} bold>[{approvalLabel}]</Text>
          )}
          {branchName && (
            <Text color={Semantic.Muted} dimColor>{branchName}</Text>
          )}
        </Box>
        <Box flexDirection="row" gap={2} alignItems="center">
          {percentage > 0 && (
            <Box flexDirection="row" gap={1} alignItems="center">
              <ContextMiniBar percentage={percentage} width={8} />
              <Text color={percentage >= 0.9 ? Semantic.Error : Semantic.Muted} dimColor>
                {(percentage * 100).toFixed(0)}%
              </Text>
            </Box>
          )}
          {!showErrorDetails && errorCount > 0 && (
            <Text color={Semantic.Error} dimColor bold={highContrast}>
              {errorCount} error{errorCount !== 1 ? 's' : ''}
            </Text>
          )}
          {debugMode && (
            <Text color={Semantic.Error} dimColor>
              {debugMessage || 'debug'}
            </Text>
          )}
        </Box>
      </Box>
    </Box>
  );
};