import React from 'react';
import { Text, Box } from 'ink';
import { Colors, Semantic } from '../../colors.js';
import { Icons } from '../../utils/icons.js';

interface InfoMessageProps {
  text: string;
}

export const InfoMessage: React.FC<InfoMessageProps> = ({ text }) => {
  return (
    <Box flexDirection="row" marginY={1} paddingX={1}>
      <Box flexShrink={0} width={1} marginRight={1}>
        <Text bold color={Semantic.Info}>{'▍'}</Text>
      </Box>
      <Box paddingRight={1}>
        <Text bold color={Semantic.Info}>{Icons.InfoLabel}</Text>
      </Box>
      <Box flexGrow={1}>
        <Text wrap="wrap" color={Colors.Foreground} dimColor>
          {text}
        </Text>
      </Box>
    </Box>
  );
};