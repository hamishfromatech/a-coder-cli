import React from 'react';
import { Box, Text } from 'ink';
import { MarkdownDisplay } from '../../utils/MarkdownDisplay.js';
import { Semantic, Colors } from '../../colors.js';
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
    <Box
      flexDirection="column"
      marginY={1}
      paddingX={2}
      paddingY={1}
      borderStyle="round"
      borderColor={Semantic.Muted}
    >
      <Box flexDirection="row" marginBottom={1}>
        <Text bold color={Semantic.Info}>coder</Text>
        {isPending && (
          <Box marginLeft={1}>
            <Text color={Semantic.Warning} dimColor>●</Text>
          </Box>
        )}
      </Box>
      <MessageResponse>
        <Box flexDirection="column">
          <MarkdownDisplay
            text={text}
            isPending={isPending}
            availableTerminalHeight={availableTerminalHeight}
            terminalWidth={terminalWidth - LAYOUT.nestIndent}
          />
        </Box>
      </MessageResponse>
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