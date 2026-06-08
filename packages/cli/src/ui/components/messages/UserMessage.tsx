import React from 'react';
import { Text, Box } from 'ink';
import { Colors, Semantic } from '../../colors.js';

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
      <Box
        flexDirection="row"
        marginY={1}
        paddingX={1}
        paddingY={1}
      >
        <Box marginRight={1} flexShrink={0}>
          <Text color={Semantic.Muted}>📋</Text>
        </Box>
        <Text color={Semantic.Muted} dimColor>
          Pasted #{pasteId}{extraLines}
        </Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      marginY={1}
      paddingX={2}
      paddingY={1}
      borderStyle="round"
      borderColor={Semantic.Secondary}
    >
      <Box flexDirection="row" marginBottom={1}>
        <Text bold color={Semantic.Primary}>you</Text>
      </Box>
      <Text wrap="wrap" color={Colors.Foreground}>
        {text}
      </Text>
    </Box>
  );
};