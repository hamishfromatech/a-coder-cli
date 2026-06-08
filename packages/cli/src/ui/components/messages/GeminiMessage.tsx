import React from 'react';
import { Box, Text } from 'ink';
import { MarkdownDisplay } from '../../utils/MarkdownDisplay.js';
import { Colors, Semantic } from '../../colors.js';
import { MessageResponse } from '../shared/MessageResponse.js';
import { LAYOUT } from '../../constants.js';

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
    <Box flexDirection="row" marginY={1} paddingX={1}>
      <Box flexShrink={0} width={1} marginRight={1}>
        <Text bold color={Semantic.Info}>{'▍'}</Text>
      </Box>
      <Box flexGrow={1} flexDirection="column">
        <MessageResponse>
          <MarkdownDisplay
            text={text}
            isPending={isPending}
            availableTerminalHeight={availableTerminalHeight}
            terminalWidth={terminalWidth - LAYOUT.nestIndent - 2}
          />
        </MessageResponse>
      </Box>
    </Box>
  );
};

export const GeminiMessage = React.memo(GeminiMessageInternal, (prevProps, nextProps) => {
  return (
    prevProps.text === nextProps.text &&
    prevProps.isPending === nextProps.isPending &&
    prevProps.terminalWidth === nextProps.terminalWidth &&
    prevProps.availableTerminalHeight === nextProps.availableTerminalHeight
  );
});