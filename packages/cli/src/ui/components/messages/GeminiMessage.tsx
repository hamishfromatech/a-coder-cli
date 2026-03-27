/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Text, Box } from 'ink';
import { MarkdownDisplay } from '../../utils/MarkdownDisplay.js';
import { Colors, Semantic } from '../../colors.js';

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
    <Box
      flexDirection="row"
      paddingX={1}
      marginY={1}
    >
      <Box paddingRight={1}>
        <Text bold color={Semantic.Primary}>[AI]</Text>
      </Box>
      <Box flexGrow={1} flexDirection="column">
        <MarkdownDisplay
          text={text}
          isPending={isPending}
          availableTerminalHeight={availableTerminalHeight}
          terminalWidth={terminalWidth}
        />
      </Box>
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
