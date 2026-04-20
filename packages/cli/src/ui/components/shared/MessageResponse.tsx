/**
 * Shared component for rendering indented response content with the ⎿ prefix character.
 * Modeled after Claude Code's MessageResponse pattern for consistent visual hierarchy.
 *
 * When nested inside another MessageResponse, the inner prefix is suppressed
 * to avoid double-prefixing.
 */

import React, { useContext } from 'react';
import { Box, Text } from 'ink';
import { Semantic } from '../../colors.js';

interface MessageResponseProps {
  children: React.ReactNode;
  height?: number;
}

/**
 * Context to track nesting and avoid rendering ⎿ inside ⎿.
 */
const MessageResponseContext = React.createContext(false);

export function MessageResponse({ children, height }: MessageResponseProps) {
  const isNested = useContext(MessageResponseContext);

  // If already inside a MessageResponse, skip the prefix
  if (isNested) {
    return <>{children}</>;
  }

  return (
    <MessageResponseContext.Provider value={true}>
      <Box flexDirection="row" height={height} overflowY={height ? 'hidden' : undefined}>
        <Box flexShrink={0}>
          <Text dimColor color={Semantic.Muted}>{'  '}⎿  </Text>
        </Box>
        <Box flexShrink={1} flexGrow={1}>
          {children}
        </Box>
      </Box>
    </MessageResponseContext.Provider>
  );
}