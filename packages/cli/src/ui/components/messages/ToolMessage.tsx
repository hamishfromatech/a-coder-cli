import React, { useEffect, useState, useRef } from 'react';
import { Box, Text } from 'ink';
import { IndividualToolCallDisplay, ToolCallStatus } from '../../types.js';
import { DiffRenderer } from './DiffRenderer.js';
import { Colors, Semantic, contrastText } from '../../colors.js';
import { MarkdownDisplay } from '../../utils/MarkdownDisplay.js';
import { GeminiRespondingSpinner } from '../GeminiRespondingSpinner.js';
import { MaxSizedBox } from '../shared/MaxSizedBox.js';
import { MessageResponse } from '../shared/MessageResponse.js';
import { CONTENT, LAYOUT } from '../../constants.js';

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

function getPillStyle(toolName: string) {
  return TOOL_PILL_COLORS[toolName];
}

function getVerbPhrase(toolName: string): string | undefined {
  return TOOL_VERB_PHRASES[toolName];
}

function getStatusColor(status: ToolCallStatus): string {
  switch (status) {
    case ToolCallStatus.Error: return Semantic.Error;
    case ToolCallStatus.Confirming: return Semantic.Warning;
    case ToolCallStatus.Pending: return Semantic.Warning;
    case ToolCallStatus.Executing: return Semantic.Info;
    case ToolCallStatus.Success: return Semantic.Success;
    case ToolCallStatus.Canceled: return Semantic.Muted;
    default: return Semantic.Secondary;
  }
}

function getStatusChar(status: ToolCallStatus): string {
  switch (status) {
    case ToolCallStatus.Success: return '✓';
    case ToolCallStatus.Error: return '✕';
    case ToolCallStatus.Canceled: return '○';
    case ToolCallStatus.Confirming: return '?';
    case ToolCallStatus.Pending: return '○';
    case ToolCallStatus.Executing: return '>';
    default: return ' ';
  }
}

function ToolElapsedTime({ startTime, durationMs, isExecuting }: { startTime?: number; durationMs?: number; isExecuting: boolean }) {
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isExecuting && startTime) {
      const tick = () => setElapsed(Date.now() - startTime);
      tick();
      intervalRef.current = setInterval(tick, 200);
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    } else if (durationMs !== undefined) {
      setElapsed(durationMs);
    }
  }, [isExecuting, startTime, durationMs]);

  if ((elapsed === 0 && !isExecuting) || elapsed < 0) return null;

  const seconds = (elapsed / 1000).toFixed(1);
  return (
    <Text dimColor color={Semantic.Muted}>
      {' '}{seconds}s
    </Text>
  );
}

const STATIC_HEIGHT = 1;
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
  startTime,
  durationMs,
}) => {
  const availableHeight = availableTerminalHeight
    ? Math.max(
        availableTerminalHeight - STATIC_HEIGHT - CONTENT.toolReservedLines,
        CONTENT.minToolLinesShown + 1,
      )
    : undefined;

  if (availableHeight) {
    renderOutputAsMarkdown = false;
  }

  const childWidth = terminalWidth - LAYOUT.nestIndent;
  if (typeof resultDisplay === 'string') {
    if (resultDisplay.length > CONTENT.maxToolResultCharacters) {
      resultDisplay =
        '...' + resultDisplay.slice(-CONTENT.maxToolResultCharacters);
    }
  }

  const pillStyle = getPillStyle(name);
  const verbPhrase = getVerbPhrase(name);
  const isExecuting = status === ToolCallStatus.Executing;
  const statusColor = getStatusColor(status);
  const statusChar = getStatusChar(status);

  return (
    <Box flexDirection="column" paddingY={1} paddingX={1}>
      <Box flexDirection="row" flexWrap="nowrap" alignItems="center" marginBottom={isExecuting || resultDisplay ? 1 : 0}>
        <Box minWidth={2} marginRight={1}>
          {isExecuting ? (
            <GeminiRespondingSpinner spinnerStyle="dots" nonRespondingDisplay="●" />
          ) : (
            <Text color={statusColor} bold>{statusChar}</Text>
          )}
        </Box>
        {pillStyle ? (
          <Box
            backgroundColor={pillStyle}
            paddingX={1}
          >
            <Text color={contrastText(pillStyle)} bold wrap="truncate-end">
              {name}
            </Text>
          </Box>
        ) : (
          <Text bold color={statusColor} wrap="truncate-end">
            {name}
          </Text>
        )}
        {description && description !== name && (
          <Box marginLeft={1}>
            <Text color={Semantic.Muted} dimColor wrap="truncate-end">
              {description}
            </Text>
          </Box>
        )}
        <ToolElapsedTime
          startTime={startTime}
          durationMs={durationMs}
          isExecuting={isExecuting}
        />
      </Box>

      {isExecuting && verbPhrase && (
        <Box paddingLeft={4} marginBottom={1}>
          <Text color={Semantic.Muted} dimColor>
            {verbPhrase}
          </Text>
        </Box>
      )}

      {resultDisplay && (
        <Box marginLeft={2}>
          <MessageResponse>
            <Box flexDirection="column" width="100%">
              {typeof resultDisplay === 'string' && renderOutputAsMarkdown && (
                <MarkdownDisplay
                  text={resultDisplay}
                  isPending={false}
                  availableTerminalHeight={availableHeight}
                  terminalWidth={childWidth}
                />
              )}
              {typeof resultDisplay === 'string' && !renderOutputAsMarkdown && (
                <MaxSizedBox maxHeight={availableHeight} maxWidth={childWidth}>
                  <Text wrap="wrap">{resultDisplay}</Text>
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
        </Box>
      )}
    </Box>
  );
};