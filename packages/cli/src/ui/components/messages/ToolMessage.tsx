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
import { getStatusIcon, getIcon } from '../../utils/icons.js';

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
const STATUS_INDICATOR_WIDTH = 3;
const MIN_LINES_SHOWN = 2; // show at least this many lines

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
        MIN_LINES_SHOWN + 1, // enforce minimum lines shown
      )
    : undefined;

  // Long tool call response in MarkdownDisplay doesn't respect availableTerminalHeight properly,
  // we're forcing it to not render as markdown when the response is too long, it will fallback
  // to render as plain text, which is contained within the terminal using MaxSizedBox
  if (availableHeight) {
    renderOutputAsMarkdown = false;
  }

  const childWidth = terminalWidth - 3; // account for padding.
  if (typeof resultDisplay === 'string') {
    if (resultDisplay.length > MAXIMUM_RESULT_DISPLAY_CHARACTERS) {
      // Truncate the result display to fit within the available width.
      resultDisplay =
        '...' + resultDisplay.slice(-MAXIMUM_RESULT_DISPLAY_CHARACTERS);
    }
  }
  return (
    <Box
      paddingX={0}
      paddingY={1}
      flexDirection="column"
    >
      <Box minHeight={1}>
        <ToolStatusIndicator status={status} />
        <ToolInfo
          name={name}
          status={status}
          description={description}
          emphasis={emphasis}
        />
        {emphasis === 'high' && <TrailingIndicator />}
      </Box>
      {resultDisplay && (
        <Box paddingLeft={STATUS_INDICATOR_WIDTH} width="100%" marginTop={1}>
          <Box flexDirection="column">
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
        </Box>
      )}
    </Box>
  );
};

type ToolStatusIndicatorProps = {
  status: ToolCallStatus;
};

const ToolStatusIndicator: React.FC<ToolStatusIndicatorProps> = ({
  status,
}) => {
  const indicator = React.useMemo(() => {
    switch (status) {
      case ToolCallStatus.Pending:
        return <Text color={Semantic.Warning}>{getIcon('Pending')}</Text>;
      case ToolCallStatus.Executing:
        return (
          <GeminiRespondingSpinner
            spinnerType="toggle"
            nonRespondingDisplay={getIcon('Running')}
          />
        );
      case ToolCallStatus.Success:
        return <Text color={Semantic.Success}>{getIcon('Success')}</Text>;
      case ToolCallStatus.Confirming:
        return <Text color={Semantic.Warning}>⠸</Text>;
      case ToolCallStatus.Canceled:
        return <Text color={Semantic.Muted}>{getIcon('Cancelled')}</Text>;
      case ToolCallStatus.Error:
        return (
          <Text color={Semantic.Error} bold>
            {getIcon('Error')}
          </Text>
        );
      default:
        return <Text> </Text>;
    }
  }, [status]);

  return <Box minWidth={STATUS_INDICATOR_WIDTH}>{indicator}</Box>;
};

type ToolInfo = {
  name: string;
  description: string;
  status: ToolCallStatus;
  emphasis: TextEmphasis;
};
const ToolInfo: React.FC<ToolInfo> = ({
  name,
  description,
  status,
  emphasis,
}) => {
  const nameColor = React.useMemo<string>(() => {
    switch (emphasis) {
      case 'high':
        return Colors.Foreground;
      case 'medium':
        return Colors.Foreground;
      case 'low':
        return Semantic.Muted;
      default: {
        const exhaustiveCheck: never = emphasis;
        return exhaustiveCheck;
      }
    }
  }, [emphasis]);
  return (
    <Box>
      <Text
        wrap="truncate-end"
        strikethrough={status === ToolCallStatus.Canceled}
      >
        <Text color={nameColor} bold>
          {name}
        </Text>{' '}
        <Text color={Semantic.Muted}>{description}</Text>
      </Text>
    </Box>
  );
};

const TrailingIndicator: React.FC = () => (
  <Text color={Colors.Foreground} wrap="truncate">
    {' '}
    ←
  </Text>
);
