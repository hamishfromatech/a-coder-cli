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
 * Generates a human-readable summary of tool operations.
 */
function generateToolSummary(toolCalls: IndividualToolCallDisplay[]): string {
  const counts: Record<string, number> = {};
  
  for (const tool of toolCalls) {
    const baseName = tool.name.replace(/_/g, ' ');
    counts[baseName] = (counts[baseName] || 0) + 1;
  }
  
  const parts: string[] = [];
  for (const [name, count] of Object.entries(counts)) {
    if (count === 1) {
      parts.push(name);
    } else {
      parts.push(`${count} ${name}s`);
    }
  }
  
  return parts.join(', ');
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
        <Text
          color={color}
          bold={isCollapsed}
        >
          {isCollapsed ? '❯' : '▼'} {summary}
        </Text>
        {isCollapsed && hasPending && (
          <Text color={Semantic.Muted}>…</Text>
        )}
        {!isComplete && (
          <Text color={Semantic.Muted}> (ctrl+o to {isCollapsed ? 'expand' : 'collapse'})</Text>
        )}
        {isComplete && (
          <Text color={Semantic.Muted}> (completed)</Text>
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
