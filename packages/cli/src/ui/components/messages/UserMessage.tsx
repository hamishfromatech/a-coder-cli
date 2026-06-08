import React from 'react';
import { Text, Box } from 'ink';
import { Colors } from '../../colors.js';

interface UserMessageProps {
  text: string;
  pastedInfo?: {
    pasteId: number;
    lineCount: number;
  };
}

export const UserMessage: React.FC<UserMessageProps> = ({ text, pastedInfo }) => {
  if (pastedInfo) {
    const { pasteId, lineCount } = pastedInfo;
    const extraLines = lineCount > 1 ? ` +${lineCount - 1} lines` : '';
    return (
      <Box paddingX={1} marginY={1}>
        <Text dimColor>[Pasted text #{pasteId}{extraLines}]</Text>
      </Box>
    );
  }

  return (
    <Box paddingX={1} marginY={1}>
      <Box flexDirection="row">
        <Box marginRight={1} flexShrink={0}>
          <Text bold color={Colors.AccentCyan}>{'>'}</Text>
        </Box>
        <Box flexGrow={1}>
          <Text wrap="wrap" color={Colors.Foreground}>
            {text}
          </Text>
        </Box>
      </Box>
    </Box>
  );
};