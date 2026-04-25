/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useState } from 'react';
import { Box, Text } from 'ink';
import { DiffRenderer } from './DiffRenderer.js';
import { Semantic } from '../../colors.js';
import {
  ToolCallConfirmationDetails,
  ToolConfirmationOutcome,
  ToolExecuteConfirmationDetails,
  ToolMcpConfirmationDetails,
  Config,
} from '@a-coder/core';
import {
  RadioButtonSelect,
  RadioSelectItem,
} from '../shared/RadioButtonSelect.js';
import { MaxSizedBox } from '../shared/MaxSizedBox.js';
import { useKeypress, type Key, stopPropagation } from '../../hooks/useKeypress.js';

/**
 * Tool name to pill color mapping for the permission dialog title.
 */
const TOOL_TYPE_COLORS: Record<string, string> = {
  edit_file: Semantic.Success,
  write_file: Semantic.Success,
  shell: Semantic.Warning,
  web_fetch: Semantic.Primary,
  web_search: Semantic.Primary,
  read_file: Semantic.Info,
  list_directory: Semantic.Info,
  glob: Semantic.Info,
  grep: Semantic.Info,
  subagent: Semantic.Info,
};

/**
 * Get a human-readable tool type label for the dialog subtitle.
 */
function getToolTypeLabel(type: string): string {
  switch (type) {
    case 'edit':
      return 'File Edit';
    case 'exec':
      return 'Bash';
    case 'info':
      return 'Web';
    case 'mcp':
      return 'MCP';
    default:
      return 'Tool';
  }
}

export interface ToolConfirmationMessageProps {
  confirmationDetails: ToolCallConfirmationDetails;
  config?: Config;
  isFocused?: boolean;
  availableTerminalHeight?: number;
  terminalWidth: number;
}

export const ToolConfirmationMessage: React.FC<
  ToolConfirmationMessageProps
> = ({
  confirmationDetails,
  isFocused = true,
  availableTerminalHeight,
  terminalWidth,
}) => {
  const { onConfirm } = confirmationDetails;
  const childWidth = terminalWidth - 2; // 2 for padding

  // Feedback input state
  const [feedbackMode, setFeedbackMode] = useState<'none' | 'accept' | 'reject'>('none');
  const [feedbackText, setFeedbackText] = useState('');

  const handleEscape = useCallback(
    (key: Key) => {
      if (key.name === 'escape') {
        onConfirm(ToolConfirmationOutcome.Cancel);
        stopPropagation();
      }
    },
    [onConfirm],
  );

  // Handle Tab key to toggle feedback input
  const handleTab = useCallback(
    (key: Key) => {
      if (key.name === 'tab' && feedbackMode === 'none') {
        setFeedbackMode('accept');
        stopPropagation();
      } else if (key.name === 'tab' && feedbackMode === 'accept') {
        setFeedbackMode('reject');
        stopPropagation();
      } else if (key.name === 'tab') {
        setFeedbackMode('none');
        setFeedbackText('');
        stopPropagation();
      }
    },
    [feedbackMode],
  );

  useKeypress(handleEscape, {
    isActive: !!isFocused,
    priority: 50,
  });

  useKeypress(handleTab, {
    isActive: !!isFocused,
    priority: 49,
  });

  const handleSelect = (item: ToolConfirmationOutcome) => {
    Promise.resolve(onConfirm(item)).catch((err: unknown) => {
      console.error('[ToolConfirmationMessage] onConfirm rejected:', err);
    });
  };

  let bodyContent: React.ReactNode | null = null;
  let question: string;
  let titleText: string;
  let titleColor: string;

  const options: Array<RadioSelectItem<ToolConfirmationOutcome>> = new Array<
    RadioSelectItem<ToolConfirmationOutcome>
  >();

  function availableBodyContentHeight() {
    if (options.length === 0) {
      throw new Error('Options not provided for confirmation message');
    }

    if (availableTerminalHeight === undefined) {
      return undefined;
    }

    const PADDING_OUTER_Y = 2;
    const MARGIN_BODY_BOTTOM = 1;
    const HEIGHT_QUESTION = 1;
    const MARGIN_QUESTION_BOTTOM = 1;
    const HEIGHT_OPTIONS = options.length;
    const HEIGHT_HINT = 1;

    const surroundingElementsHeight =
      PADDING_OUTER_Y +
      MARGIN_BODY_BOTTOM +
      HEIGHT_QUESTION +
      MARGIN_QUESTION_BOTTOM +
      HEIGHT_OPTIONS +
      HEIGHT_HINT;
    return Math.max(availableTerminalHeight - surroundingElementsHeight, 1);
  }

  if (confirmationDetails.type === 'edit') {
    if (confirmationDetails.isModifying) {
      return (
        <Box
          minWidth="90%"
          borderStyle="round"
          borderColor={Semantic.Muted}
          justifyContent="space-around"
          padding={1}
          overflow="hidden"
        >
          <Text>Modify in progress: </Text>
          <Text color={Semantic.Success}>
            Save and close external editor to continue
          </Text>
        </Box>
      );
    }

    question = `Apply this change?`;
    titleText = 'File Edit';
    titleColor = Semantic.Success;
    options.push(
      {
        label: 'Yes, allow once',
        value: ToolConfirmationOutcome.ProceedOnce,
      },
      {
        label: 'Yes, allow always',
        value: ToolConfirmationOutcome.ProceedAlways,
      },
      {
        label: 'Modify with external editor',
        value: ToolConfirmationOutcome.ModifyWithEditor,
      },
      { label: 'No (esc)', value: ToolConfirmationOutcome.Cancel },
    );
    bodyContent = (
      <DiffRenderer
        diffContent={confirmationDetails.fileDiff}
        filename={confirmationDetails.fileName}
        availableTerminalHeight={availableBodyContentHeight()}
        terminalWidth={childWidth}
      />
    );
  } else if (confirmationDetails.type === 'exec') {
    const executionProps =
      confirmationDetails as ToolExecuteConfirmationDetails;

    question = `Allow execution?`;
    titleText = 'Bash';
    titleColor = Semantic.Warning;
    options.push(
      {
        label: 'Yes, allow once',
        value: ToolConfirmationOutcome.ProceedOnce,
      },
      {
        label: `Yes, allow always "${executionProps.rootCommand} ..."`,
        value: ToolConfirmationOutcome.ProceedAlways,
      },
      { label: 'No (esc)', value: ToolConfirmationOutcome.Cancel },
    );

    let bodyContentHeight = availableBodyContentHeight();
    if (bodyContentHeight !== undefined) {
      bodyContentHeight -= 2;
    }
    bodyContent = (
      <Box flexDirection="column">
        <Box paddingX={1} marginLeft={1}>
          <MaxSizedBox
            maxHeight={bodyContentHeight}
            maxWidth={Math.max(childWidth - 4, 1)}
          >
            <Box>
              <Text color={Semantic.Info}>{executionProps.command}</Text>
            </Box>
          </MaxSizedBox>
        </Box>
      </Box>
    );
  } else if (confirmationDetails.type === 'info') {
    const infoProps = confirmationDetails;
    const displayUrls =
      infoProps.urls &&
      !(infoProps.urls.length === 1 && infoProps.urls[0] === infoProps.prompt);

    question = `Do you want to proceed?`;
    titleText = 'Web';
    titleColor = Semantic.Primary;
    options.push(
      {
        label: 'Yes, allow once',
        value: ToolConfirmationOutcome.ProceedOnce,
      },
      {
        label: 'Yes, allow always',
        value: ToolConfirmationOutcome.ProceedAlways,
      },
      { label: 'No (esc)', value: ToolConfirmationOutcome.Cancel },
    );

    bodyContent = (
      <Box flexDirection="column" paddingX={1} marginLeft={1}>
        <Text color={Semantic.Info}>{infoProps.prompt}</Text>
        {displayUrls && infoProps.urls && infoProps.urls.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text>URLs to fetch:</Text>
            {infoProps.urls.map((url) => (
              <Text key={url}> - {url}</Text>
            ))}
          </Box>
        )}
      </Box>
    );
  } else {
    // mcp tool confirmation
    const mcpProps = confirmationDetails as ToolMcpConfirmationDetails;

    bodyContent = (
      <Box flexDirection="column" paddingX={1} marginLeft={1}>
        <Text color={Semantic.Info}>MCP Server: {mcpProps.serverName}</Text>
        <Text color={Semantic.Info}>Tool: {mcpProps.toolName}</Text>
      </Box>
    );

    question = `Allow execution of MCP tool "${mcpProps.toolName}" from server "${mcpProps.serverName}"?`;
    titleText = 'MCP';
    titleColor = Semantic.Info;
    options.push(
      {
        label: 'Yes, allow once',
        value: ToolConfirmationOutcome.ProceedOnce,
      },
      {
        label: `Yes, always allow tool "${mcpProps.toolName}" from server "${mcpProps.serverName}"`,
        value: ToolConfirmationOutcome.ProceedAlwaysTool,
      },
      {
        label: `Yes, always allow all tools from server "${mcpProps.serverName}"`,
        value: ToolConfirmationOutcome.ProceedAlwaysServer,
      },
      { label: 'No (esc)', value: ToolConfirmationOutcome.Cancel },
    );
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      {/* Rounded top border dialog */}
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={titleColor}
        borderLeft={false}
        borderRight={false}
        borderBottom={false}
      >
        {/* Title area with pill */}
        <Box paddingX={1} flexDirection="column">
          <Box justifyContent="space-between" alignItems="center">
            <Box flexDirection="row" alignItems="center">
              <Text
                bold
                backgroundColor={titleColor}
                color="black"
              >
                {' ' + titleText + ' '}
              </Text>
            </Box>
          </Box>
        </Box>

        {/* Body Content (Diff Renderer or Command Info) */}
        <Box flexDirection="column" paddingX={1}>
          {bodyContent}
        </Box>
      </Box>

      {/* Confirmation Question */}
      <Box marginBottom={0} marginTop={1} flexShrink={0} paddingLeft={1}>
        <Text wrap="truncate" bold>{question}</Text>
      </Box>

      {/* Select Input for Options */}
      <Box flexShrink={0} paddingLeft={1} marginTop={0}>
        <RadioButtonSelect
          items={options}
          onSelect={handleSelect}
          isFocused={isFocused}
        />
      </Box>

      {/* Hint line */}
      <Box marginTop={0} paddingLeft={1}>
        <Text dimColor color={Semantic.Muted}>
          esc cancel{feedbackMode === 'none' && ' · tab amend'}
          {feedbackMode !== 'none' && ' · tab switch'}
        </Text>
      </Box>

      {/* Feedback input area */}
      {feedbackMode !== 'none' && (
        <Box marginTop={1} paddingLeft={1} flexDirection="column">
          <Text dimColor color={Semantic.Muted}>
            {feedbackMode === 'accept'
              ? 'what should happen next:'
              : 'what to do differently:'}
          </Text>
          <Box flexDirection="row" marginTop={0}>
            <Text color={Semantic.Primary}>{'> '}</Text>
            <Text>{feedbackText}</Text>
            <Text dimColor>▏</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
};