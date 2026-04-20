/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { MarkdownDisplay } from '../../utils/MarkdownDisplay.js';
import { Semantic } from '../../colors.js';
import { MessageResponse } from '../shared/MessageResponse.js';

interface GeminiMessageProps {
  text: string;
  isPending: boolean;
  availableTerminalHeight?: number;
  terminalWidth: number;
}

const GeminiMessageInternal: React.FC<GeminiMessageProps> = ({
  text,
  isPending,
  availableTerminalHeight,
  terminalWidth,
}) => {
  return (
    <Box flexDirection="column" marginY={1}>
      <MessageResponse>
        <Box flexDirection="column">
          <MarkdownDisplay
            text={text}
            isPending={isPending}
            availableTerminalHeight={availableTerminalHeight}
            terminalWidth={terminalWidth - 5}
          />
        </Box>
      </MessageResponse>
    </Box>
  );
};

/**
 * Memoized Gemini message component to prevent unnecessary re-renders
 * during streaming. Only re-renders when text content or props change.
 */
export const GeminiMessage = React.memo(GeminiMessageInternal, (prevProps, nextProps) => {
  // Only re-render if text changed or relevant props changed
  return (
    prevProps.text === nextProps.text &&
    prevProps.isPending === nextProps.isPending &&
    prevProps.terminalWidth === nextProps.terminalWidth &&
    prevProps.availableTerminalHeight === nextProps.availableTerminalHeight
  );
});