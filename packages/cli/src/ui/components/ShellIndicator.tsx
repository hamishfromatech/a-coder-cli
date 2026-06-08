import React from 'react';
import { Box, Text } from 'ink';
import { Semantic, Colors } from '../colors.js';

interface ShellIndicatorProps {
  shells: Array<{ id: string; command: string; status: string }>;
  isFocused: boolean;
  onSelectShell: (id: string) => void;
}

export const ShellIndicator: React.FC<ShellIndicatorProps> = ({
  shells,
  isFocused,
  onSelectShell,
}) => {
  const running = shells.filter((s) => s.status === 'running').length;
  const done = shells.filter((s) => s.status === 'completed').length;

  return (
    <Box
      backgroundColor={isFocused ? Semantic.Primary : Colors.Gray}
      paddingX={1}
    >
      <Text color="black" bold>
        &gt;_ {running > 0 && `${running}${done > 0 ? '/' : ''}`}{done > 0 ? `${done}` : ''}
      </Text>
    </Box>
  );
};