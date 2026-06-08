import React from 'react';
import { Box, Text } from 'ink';
import { Semantic } from '../colors.js';
import { longAsciiLogo } from './AsciiArt.js';

interface HeaderProps {
  customAsciiArt?: string;
  terminalWidth: number;
  version: string;
  nightly: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  customAsciiArt,
  terminalWidth,
  version,
  nightly,
}) => {
  const showShort = terminalWidth < 50;
  const displayTitle = showShort ? 'A-CODER' : (customAsciiArt || longAsciiLogo);

  return (
    <Box
      marginBottom={1}
      flexDirection="column"
      width={terminalWidth}
    >
      <Box flexDirection="row" alignItems="center" justifyContent="space-between">
        <Text bold color={Semantic.Primary}>
          {displayTitle}
        </Text>
        <Box flexDirection="row" gap={1} alignItems="center">
          {nightly && (
            <Box
              borderStyle="round"
              borderColor={Semantic.Warning}
              paddingX={1}
              paddingY={0}
            >
              <Text color={Semantic.Warning} bold>nightly</Text>
            </Box>
          )}
          <Box
            borderStyle="round"
            borderColor={Semantic.Muted}
            paddingX={1}
            paddingY={0}
          >
            <Text color={Semantic.Muted} dimColor>v{version}</Text>
          </Box>
        </Box>
      </Box>
    </Box>
  );
};