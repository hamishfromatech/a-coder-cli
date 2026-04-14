/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import type { HistoryItem } from '../types.js';
import { UserMessage } from './messages/UserMessage.js';
import { UserShellMessage } from './messages/UserShellMessage.js';
import { GeminiMessage } from './messages/GeminiMessage.js';
import { InfoMessage } from './messages/InfoMessage.js';
import { ErrorMessage } from './messages/ErrorMessage.js';
import { ToolGroupMessage } from './messages/ToolGroupMessage.js';
import { CollapsibleToolGroup } from './messages/CollapsibleToolGroup.js';
import { GeminiMessageContent } from './messages/GeminiMessageContent.js';
import { CompressionMessage } from './messages/CompressionMessage.js';
import { Box } from 'ink';
import { AboutBox } from './AboutBox.js';
import { StatsDisplay } from './StatsDisplay.js';
import { ModelStatsDisplay } from './ModelStatsDisplay.js';
import { ToolStatsDisplay } from './ToolStatsDisplay.js';
import { SessionSummaryDisplay } from './SessionSummaryDisplay.js';
import { Config } from '@a-coder/core';

interface HistoryItemDisplayProps {
  item: HistoryItem;
  availableTerminalHeight?: number;
  terminalWidth: number;
  isPending: boolean;
  config?: Config;
  isFocused?: boolean;
}

const HistoryItemDisplayInternal: React.FC<HistoryItemDisplayProps> = ({
  item,
  availableTerminalHeight,
  terminalWidth,
  isPending,
  config,
  isFocused = true,
}) => {
  // Early return for empty tool groups to avoid unnecessary rendering
  if (item.type === 'tool_group' && item.tools.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column">
      {/* Render standard message types */}
      {item.type === 'user' && (
        <UserMessage text={item.text} pastedInfo={item.pastedInfo} />
      )}
      {item.type === 'user_shell' && <UserShellMessage text={item.text} />}
      {item.type === 'gemini' && (
        <GeminiMessage
          text={item.text}
          isPending={isPending}
          availableTerminalHeight={availableTerminalHeight}
          terminalWidth={terminalWidth}
        />
      )}
      {item.type === 'gemini_content' && (
        <GeminiMessageContent
          text={item.text}
          isPending={isPending}
          availableTerminalHeight={availableTerminalHeight}
          terminalWidth={terminalWidth}
        />
      )}
      {item.type === 'info' && <InfoMessage text={item.text} />}
      {item.type === 'error' && <ErrorMessage text={item.text} />}
      {item.type === 'about' && (
        <AboutBox
          cliVersion={item.cliVersion}
          osVersion={item.osVersion}
          sandboxEnv={item.sandboxEnv}
          modelVersion={item.modelVersion}
          selectedAuthType={item.selectedAuthType}
          gcpProject={item.gcpProject}
        />
      )}
      {item.type === 'stats' && <StatsDisplay duration={item.duration} />}
      {item.type === 'model_stats' && <ModelStatsDisplay />}
      {item.type === 'tool_stats' && <ToolStatsDisplay />}
      {item.type === 'quit' && <SessionSummaryDisplay duration={item.duration} />}
      {item.type === 'tool_group' && !item.collapsible && (
        <ToolGroupMessage
          toolCalls={item.tools}
          groupId={item.id}
          availableTerminalHeight={availableTerminalHeight}
          terminalWidth={terminalWidth}
          config={config}
          isFocused={isFocused}
        />
      )}
      {item.type === 'tool_group' && item.collapsible && (
        <CollapsibleToolGroup
          groupId={item.id}
          toolCalls={item.tools}
          availableTerminalHeight={availableTerminalHeight}
          terminalWidth={terminalWidth}
          config={config}
          isFocused={isFocused}
          defaultCollapsed={true}
        />
      )}
      {item.type === 'compression' && (
        <CompressionMessage compression={item.compression} />
      )}
    </Box>
  );
};

/**
 * Memoized history item display to prevent unnecessary re-renders.
 * Only re-renders when the item content or relevant props change.
 */
export const HistoryItemDisplay = React.memo(HistoryItemDisplayInternal, (prevProps, nextProps) => {
  // Custom comparison for optimal re-render prevention
  // Re-render only if these props change
  return (
    prevProps.item.id === nextProps.item.id &&
    prevProps.item.type === nextProps.item.type &&
    prevProps.isPending === nextProps.isPending &&
    prevProps.isFocused === nextProps.isFocused &&
    prevProps.terminalWidth === nextProps.terminalWidth &&
    prevProps.availableTerminalHeight === nextProps.availableTerminalHeight &&
    // For text-based items, compare text content
    (prevProps.item.type !== 'gemini' &&
    prevProps.item.type !== 'gemini_content' &&
    prevProps.item.type !== 'user' &&
    prevProps.item.type !== 'user_shell' &&
    prevProps.item.type !== 'info' &&
    prevProps.item.type !== 'error'
      ? true
      : (prevProps.item as { text?: string }).text ===
        (nextProps.item as { text?: string }).text) &&
    // For tool groups, compare tools array length as a quick check
    (prevProps.item.type !== 'tool_group' ||
      (prevProps.item as { tools?: unknown[] }).tools?.length ===
        (nextProps.item as { tools?: unknown[] }).tools?.length)
  );
});
