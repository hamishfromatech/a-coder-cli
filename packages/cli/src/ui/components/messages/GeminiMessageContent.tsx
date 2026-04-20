/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box } from 'ink';
import { MarkdownDisplay } from '../../utils/MarkdownDisplay.js';
import { MessageResponse } from '../shared/MessageResponse.js';

interface GeminiMessageContentProps {
  text: string;
  isPending: boolean;
  availableTerminalHeight?: number;
  terminalWidth: number;
}

/*
 * Gemini message content represents a partial of GeminiMessage and is only used
 * when a response gets too long. Messages are split into multiple
 * GeminiMessageContent's for performance. Uses MessageResponse to maintain
 * consistent ⎿ prefix alignment with the parent message.
 */
const GeminiMessageContentInternal: React.FC<GeminiMessageContentProps> = ({
  text,
  isPending,
  availableTerminalHeight,
  terminalWidth,
}) => {
  return (
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
  );
};

/**
 * Memoized Gemini message content component to prevent unnecessary re-renders
 * during streaming. Only re-renders when text content or props change.
 */
export const GeminiMessageContent = React.memo(GeminiMessageContentInternal, (prevProps, nextProps) => {
  // Only re-render if text changed or relevant props changed
  return (
    prevProps.text === nextProps.text &&
    prevProps.isPending === nextProps.isPending &&
    prevProps.terminalWidth === nextProps.terminalWidth &&
    prevProps.availableTerminalHeight === nextProps.availableTerminalHeight
  );
});