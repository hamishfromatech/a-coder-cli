/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { IndividualToolCallDisplay, ToolCallStatus } from '../../types.js';
import { DiffRenderer } from './DiffRenderer.js';
import { Colors, Semantic } from '../../colors.js';
import { MarkdownDisplay } from '../../utils/MarkdownDisplay.js';
import { GeminiRespondingSpinner } from '../GeminiRespondingSpinner.js';
import { MaxSizedBox } from '../shared/MaxSizedBox.js';
import { MessageResponse } from '../shared/MessageResponse.js';

/**
 * Map of tool internal names to their pill background colors.
 * These colors categorize tools visually:
 * - Cyan: read/search operations
 * - Green: write/edit operations
 * - Yellow: execution/shell operations
 * - Purple: web/network operations
 * - Blue: agent/special operations
 */
const TOOL_PILL_COLORS: Record<string, string> = {
  read_file: Colors.AccentCyan,
  list_directory: Colors.AccentCyan,
  glob: Colors.AccentCyan,
  grep: Colors.AccentCyan,
  write_file: Colors.AccentGreen,
  edit_file: Colors.AccentGreen,
  shell: Colors.AccentYellow,
  web_fetch: Colors.AccentPurple,
  web_search: Colors.AccentPurple,
  subagent: Colors.AccentBlue,
  task_create: Colors.AccentBlue,
  task_update: Colors.AccentBlue,
  task_list: Colors.AccentCyan,
  task_get: Colors.AccentCyan,
  skills: Colors.AccentPurple,
  memory: Colors.AccentGreen,
  write_todos: Colors.AccentGreen,
  initialize_heartbeat: Colors.AccentYellow,
  exit_heartbeat: Colors.AccentYellow,
};

/**
 * Map of tool internal names to their verb phrases for in-progress spinners.
 */
const TOOL_VERB_PHRASES: Record<string, string> = {
  read_file: 'Reading...',
  list_directory: 'Listing...',
  glob: 'Searching...',
  grep: 'Searching...',
  write_file: 'Writing...',
  edit_file: 'Editing...',
  shell: 'Running...',
  web_fetch: 'Fetching...',
  web_search: 'Searching...',
  subagent: 'Thinking...',
  task_create: 'Creating task...',
  task_update: 'Updating task...',
  task_list: 'Listing tasks...',
  task_get: 'Getting task...',
  skills: 'Loading skill...',
  memory: 'Remembering...',
  write_todos: 'Updating todos...',
  initialize_heartbeat: 'Starting heartbeat...',
  exit_heartbeat: 'Stopping heartbeat...',
};

/**
 * Get the pill background color for a tool name.
 */
function getPillColor(toolName: string): string | undefined {
  return TOOL_PILL_COLORS[toolName];
}

/**
 * Get the verb phrase for a tool in progress.
 */
function getVerbPhrase(toolName: string): string | undefined {
  return TOOL_VERB_PHRASES[toolName];
}

/**
 * Determines the border color based on tool call status.
 */
function getBorderColor(status: ToolCallStatus): string {
  switch (status) {
    case ToolCallStatus.Error:
      return Semantic.Error;
    case ToolCallStatus.Confirming:
      return Semantic.Warning;
    case ToolCallStatus.Pending:
      return Semantic.Warning;
    case ToolCallStatus.Executing:
      return Semantic.Info;
    case ToolCallStatus.Success:
      return Semantic.Success;
    case ToolCallStatus.Canceled:
      return Semantic.Muted;
    default:
      return Semantic.Secondary;
  }
}

const STATIC_HEIGHT = 1;
const RESERVED_LINE_COUNT = 5; // for tool name, status, padding etc.
const MIN_LINES_SHOWN = 2;

// Large threshold to ensure we don't cause performance issues for very large
// outputs that will get truncated further by MaxSizedBox anyway.
const MAXIMUM_RESULT_DISPLAY_CHARACTERS = 1000000;
export type TextEmphasis = 'high' | 'medium' | 'low';

export interface ToolMessageProps extends IndividualToolCallDisplay {
  availableTerminalHeight?: number;
  terminalWidth: number;
  emphasis?: TextEmphasis;
  renderOutputAsMarkdown?: boolean;
}

export const ToolMessage: React.FC<ToolMessageProps> = ({
  name,
  description,
  resultDisplay,
  status,
  availableTerminalHeight,
  terminalWidth,
  emphasis = 'medium',
  renderOutputAsMarkdown = true,
}) => {
  const availableHeight = availableTerminalHeight
    ? Math.max(
        availableTerminalHeight - STATIC_HEIGHT - RESERVED_LINE_COUNT,
        MIN_LINES_SHOWN + 1,
      )
    : undefined;

  // Long tool call response in MarkdownDisplay doesn't respect availableTerminalHeight properly,
  // we're forcing it to not render as markdown when the response is too long, it will fallback
  // to render as plain text, which is contained within the terminal using MaxSizedBox
  if (availableHeight) {
    renderOutputAsMarkdown = false;
  }

  const childWidth = terminalWidth - 5; // account for ⎿ prefix + padding
  if (typeof resultDisplay === 'string') {
    if (resultDisplay.length > MAXIMUM_RESULT_DISPLAY_CHARACTERS) {
      resultDisplay =
        '...' + resultDisplay.slice(-MAXIMUM_RESULT_DISPLAY_CHARACTERS);
    }
  }

  const pillColor = getPillColor(name);
  const verbPhrase = getVerbPhrase(name);
  const isExecuting = status === ToolCallStatus.Executing;

  return (
    <Box flexDirection="column" paddingY={1}>
      {/* Tool name row: [dot] [pill:ToolName] (description) */}
      <Box flexDirection="row" flexWrap="nowrap" alignItems="center">
        {/* Blinking dot indicator for in-progress tools */}
        {isExecuting && (
          <Box minWidth={2} marginRight={1}>
            <GeminiRespondingSpinner spinnerType="toggle" nonRespondingDisplay="●" />
          </Box>
        )}
        {!isExecuting && status === ToolCallStatus.Success && (
          <Box minWidth={2} marginRight={1}>
            <Text color={Semantic.Success}>✓</Text>
          </Box>
        )}
        {!isExecuting && status === ToolCallStatus.Error && (
          <Box minWidth={2} marginRight={1}>
            <Text color={Semantic.Error} bold>✕</Text>
          </Box>
        )}
        {!isExecuting && status === ToolCallStatus.Canceled && (
          <Box minWidth={2} marginRight={1}>
            <Text color={Semantic.Muted}>○</Text>
          </Box>
        )}
        {!isExecuting && status === ToolCallStatus.Confirming && (
          <Box minWidth={2} marginRight={1}>
            <Text color={Semantic.Warning}>⠸</Text>
          </Box>
        )}
        {!isExecuting && status === ToolCallStatus.Pending && (
          <Box minWidth={2} marginRight={1}>
            <Text color={Semantic.Muted}>○</Text>
          </Box>
        )}

        {/* Tool name pill */}
        <Text
          bold
          wrap="truncate-end"
          backgroundColor={pillColor}
          color={pillColor ? 'black' : undefined}
        >
          {' ' + name + ' '}
        </Text>

        {/* Description in parentheses */}
        {description && description !== name && (
          <Box flexWrap="wrap" marginLeft={1}>
            <Text color={Semantic.Muted} wrap="truncate-end">
              {description}
            </Text>
          </Box>
        )}
      </Box>

      {/* Verb phrase for executing tools */}
      {isExecuting && verbPhrase && (
        <Box paddingLeft={3}>
          <Text dimColor color={Semantic.Primary}>
            {verbPhrase}
          </Text>
        </Box>
      )}

      {/* Result display */}
      {resultDisplay && (
        <MessageResponse>
          <Box flexDirection="column" width="100%">
            {typeof resultDisplay === 'string' && renderOutputAsMarkdown && (
              <Box flexDirection="column">
                <MarkdownDisplay
                  text={resultDisplay}
                  isPending={false}
                  availableTerminalHeight={availableHeight}
                  terminalWidth={childWidth}
                />
              </Box>
            )}
            {typeof resultDisplay === 'string' && !renderOutputAsMarkdown && (
              <MaxSizedBox maxHeight={availableHeight} maxWidth={childWidth}>
                <Box>
                  <Text wrap="wrap">{resultDisplay}</Text>
                </Box>
              </MaxSizedBox>
            )}
            {typeof resultDisplay !== 'string' && (
              <DiffRenderer
                diffContent={resultDisplay.fileDiff}
                filename={resultDisplay.fileName}
                availableTerminalHeight={availableHeight}
                terminalWidth={childWidth}
              />
            )}
          </Box>
        </MessageResponse>
      )}
    </Box>
  );
};