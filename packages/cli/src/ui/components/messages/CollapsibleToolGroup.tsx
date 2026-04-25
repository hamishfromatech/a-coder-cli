/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useCallback, useMemo } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import { IndividualToolCallDisplay, ToolCallStatus } from '../../types.js';
import { ToolMessage } from './ToolMessage.js';
import { ToolConfirmationMessage } from './ToolConfirmationMessage.js';
import { Colors, Semantic } from '../../colors.js';
import { Config } from '@a-coder/core';
import { useMinDisplayTime } from '../../hooks/useMinDisplayTime.js';
import { LAYOUT } from '../../constants.js';

interface CollapsibleToolGroupProps {
  groupId: number;
  toolCalls: IndividualToolCallDisplay[];
  availableTerminalHeight?: number;
  terminalWidth: number;
  config?: Config;
  isFocused?: boolean;
  defaultCollapsed?: boolean;
}

/**
 * Tool name categories for compact summary labels.
 */
const TOOL_CATEGORIES: Record<string, { verb: string; noun: string }> = {
  read_file: { verb: 'read', noun: 'file' },
  glob: { verb: 'searched', noun: 'pattern' },
  grep: { verb: 'searched', noun: 'pattern' },
  list_directory: { verb: 'listed', noun: 'directory' },
  web_fetch: { verb: 'fetched', noun: 'URL' },
  web_search: { verb: 'searched', noun: 'query' },
};

const MAX_DETAIL_ITEMS = 4;

/**
 * Generates a compact, category-aware summary of tool operations.
 * E.g., "read 3 files (src/App.ts, src/utils.ts, lib/config.ts)"
 */
function generateToolSummary(toolCalls: IndividualToolCallDisplay[]): string {
  const categoryCounts: Record<string, number> = {};
  const categoryDescriptions: Record<string, string[]> = {};

  for (const tool of toolCalls) {
    categoryCounts[tool.name] = (categoryCounts[tool.name] || 0) + 1;
    if (!categoryDescriptions[tool.name]) categoryDescriptions[tool.name] = [];
    categoryDescriptions[tool.name].push(tool.description || '');
  }

  const parts: string[] = [];
  for (const [toolName, count] of Object.entries(categoryCounts)) {
    const cat = TOOL_CATEGORIES[toolName];
    if (cat) {
      const noun = count > 1 ? cat.noun + 's' : cat.noun;
      const descs = categoryDescriptions[toolName];
      const detail = formatDetailList(descs);
      parts.push(detail ? `${cat.verb} ${count} ${noun} (${detail})` : `${cat.verb} ${count} ${noun}`);
    } else {
      const displayName = toolName.replace(/_/g, ' ');
      parts.push(count > 1 ? `${count} ${displayName}s` : displayName);
    }
  }

  return parts.join(', ');
}

/**
 * Formats a list of tool descriptions into a compact parenthetical.
 * Deduplicates "." entries and truncates when there are too many.
 */
function formatDetailList(descs: string[]): string {
  const filtered = descs.filter((d) => d && d !== '.' && d !== 'Path unavailable');
  if (filtered.length === 0) return '';

  const unique = [...new Set(filtered)];
  if (unique.length > MAX_DETAIL_ITEMS) {
    const shown = unique.slice(0, MAX_DETAIL_ITEMS - 1);
    const remaining = unique.length - shown.length;
    return `${shown.join(', ')}, +${remaining} more`;
  }
  return unique.join(', ');
}

/**
 * Determines if all tools are in a terminal state (success, error, or cancelled).
 */
function allToolsComplete(toolCalls: IndividualToolCallDisplay[]): boolean {
  return toolCalls.every(
    (t) =>
      t.status === ToolCallStatus.Success ||
      t.status === ToolCallStatus.Error ||
      t.status === ToolCallStatus.Canceled
  );
}

/**
 * Gets the appropriate icon based on the state of tools.
 */
function getGroupIcon(toolCalls: IndividualToolCallDisplay[]): { icon: string; color: string } {
  const hasError = toolCalls.some((t) => t.status === ToolCallStatus.Error);
  const hasExecuting = toolCalls.some((t) => t.status === ToolCallStatus.Executing);
  const hasPending = toolCalls.some(
    (t) => t.status === ToolCallStatus.Pending || t.status === ToolCallStatus.Confirming
  );
  const complete = allToolsComplete(toolCalls);
  const hasCanceled = toolCalls.some((t) => t.status === ToolCallStatus.Canceled);

  if (hasError) return { icon: '✕', color: Semantic.Error };
  if (complete && !hasCanceled) return { icon: '⏺', color: Semantic.Success };
  if (complete && hasCanceled) return { icon: '⏺', color: Semantic.Muted };
  if (hasExecuting) return { icon: '⏺', color: Semantic.Info };
  if (hasPending) return { icon: '❯', color: Semantic.Warning };
  return { icon: '❯', color: Semantic.Secondary };
}

export const CollapsibleToolGroup: React.FC<CollapsibleToolGroupProps> = ({
  groupId,
  toolCalls,
  availableTerminalHeight,
  terminalWidth,
  config,
  isFocused = true,
  defaultCollapsed = true,
}) => {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  const toggleCollapse = useCallback(() => {
    setIsCollapsed((prev) => !prev);
  }, []);

  // Register keyboard handler for ctrl+o
  useInput((_input: string, key: Key) => {
    if (key.ctrl && _input === 'o') {
      toggleCollapse();
    }
  });

  const summary = useMemo(() => generateToolSummary(toolCalls), [toolCalls]);
  const { icon, color } = useMemo(() => getGroupIcon(toolCalls), [toolCalls]);
  const isComplete = useMemo(() => allToolsComplete(toolCalls), [toolCalls]);

  // Hold the collapsed summary visible for at least 700ms after completion
  // to prevent flickering when tool groups complete very quickly
  const showCompletedHint = useMinDisplayTime(isComplete, LAYOUT.collapsibleHoldMs);

  const hasPending = useMemo(
    () => !toolCalls.every((t) => t.status === ToolCallStatus.Success),
    [toolCalls]
  );

  const staticHeight = 1;
  const innerWidth = terminalWidth - 4;

  // Calculate available height per tool when expanded
  let countToolCallsWithResults = 0;
  for (const tool of toolCalls) {
    if (tool.resultDisplay !== undefined && tool.resultDisplay !== '') {
      countToolCallsWithResults++;
    }
  }
  const countOneLineToolCalls = toolCalls.length - countToolCallsWithResults;
  const availableTerminalHeightPerToolMessage = availableTerminalHeight
    ? Math.max(
        Math.floor(
          (availableTerminalHeight - staticHeight - countOneLineToolCalls) /
            Math.max(1, countToolCallsWithResults)
        ),
        1
      )
    : undefined;

  // Find tool awaiting approval
  const toolAwaitingApproval = useMemo(
    () => toolCalls.find((tc) => tc.status === ToolCallStatus.Confirming),
    [toolCalls]
  );

  return (
    <Box
      flexDirection="column"
      width="100%"
      marginLeft={1}
    >
      {/* Collapsible header */}
      <Box paddingX={1} paddingY={0}>
        {isCollapsed ? (
          <Text color={Semantic.Muted} dimColor>{'  '}⎿  </Text>
        ) : null}
        <Text
          color={color}
          bold={isCollapsed}
        >
          {isCollapsed ? '▸' : '▾'} {summary}
        </Text>
        {isCollapsed && hasPending && (
          <Text color={Semantic.Muted} dimColor>...</Text>
        )}
        {!isComplete && (
          <Text color={Semantic.Muted} dimColor> ctrl+o to {isCollapsed ? 'expand' : 'collapse'}</Text>
        )}
        {isComplete && showCompletedHint && (
          <Text color={Semantic.Muted}> done</Text>
        )}
      </Box>

      {/* Expanded content */}
      {!isCollapsed && (
        <Box flexDirection="column" marginLeft={2}>
          {toolCalls.map((tool) => {
            const isConfirming = toolAwaitingApproval?.callId === tool.callId;
            return (
              <Box key={tool.callId} flexDirection="column" minHeight={1}>
                <Box flexDirection="row" alignItems="center">
                  <ToolMessage
                    callId={tool.callId}
                    name={tool.name}
                    description={tool.description}
                    resultDisplay={tool.resultDisplay}
                    status={tool.status}
                    confirmationDetails={tool.confirmationDetails}
                    availableTerminalHeight={availableTerminalHeightPerToolMessage}
                    terminalWidth={innerWidth}
                    emphasis={
                      isConfirming
                        ? 'high'
                        : toolAwaitingApproval
                          ? 'low'
                          : 'medium'
                    }
                    renderOutputAsMarkdown={tool.renderOutputAsMarkdown}
                  />
                </Box>
                {tool.status === ToolCallStatus.Confirming &&
                  isConfirming &&
                  tool.confirmationDetails && (
                    <ToolConfirmationMessage
                      confirmationDetails={tool.confirmationDetails}
                      config={config}
                      isFocused={isFocused}
                      availableTerminalHeight={
                        availableTerminalHeightPerToolMessage
                      }
                      terminalWidth={innerWidth}
                    />
                  )}
              </Box>
            );
          })}
        </Box>
      )}
    </Box>
  );
};
