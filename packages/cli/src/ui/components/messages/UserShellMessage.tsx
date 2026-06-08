import React from 'react';
import { Box, Text } from 'ink';
import { Colors, Semantic } from '../../colors.js';

interface UserShellMessageProps {
  text: string;
}

export const UserShellMessage: React.FC<UserShellMessageProps> = ({ text }) => {
  const commandToDisplay = text.startsWith('!') ? text.substring(1) : text;

  return (
    <Box flexDirection="row" marginY={1} paddingX={1}>
      <Box flexShrink={0} width={1} marginRight={1}>
        <Text bold color={Semantic.Warning}>{'▍'}</Text>
      </Box>
      <Text dimColor>$</Text>
      <Box marginLeft={1}>
        <Text color={Colors.Foreground}>{commandToDisplay}</Text>
      </Box>
    </Box>
  );
};