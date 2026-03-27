/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box } from 'ink';
import { MarkdownDisplay } from '../../utils/MarkdownDisplay.js';

interface GeminiMessageContentProps {
  text: string;
  isPending: boolean;
  availableTerminalHeight?: number;
  terminalWidth: number;
}

/*
 * Gemini message content is a semi-hacked component. The intention is to represent a partial
 * of GeminiMessage and is only used when a response gets too long. In that instance messages
 * are split into multiple GeminiMessageContent's to enable the root <Static> component in
 * App.tsx to be as performant as humanly possible.
 */
const GeminiMessageContentInternal: React.FC<GeminiMessageContentProps> = ({
  text,
  isPending,
  availableTerminalHeight,
  terminalWidth,
}) => {
  const originalPrefix = '👑 ';
  const prefixWidth = originalPrefix.length;

  return (
    <Box flexDirection="column" paddingLeft={prefixWidth}>
      <MarkdownDisplay
        text={text}
        isPending={isPending}
        availableTerminalHeight={availableTerminalHeight}
        terminalWidth={terminalWidth}
      />
    </Box>
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
