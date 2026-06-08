import React from 'react';
import { Box, Text } from 'ink';
import { Semantic } from '../../colors.js';

interface DividerProps {
  width?: number;
  char?: string;
  color?: string;
  dimColor?: boolean;
  marginTop?: number;
  marginBottom?: number;
  label?: string;
}

export const Divider: React.FC<DividerProps> = ({
  width = 40,
  char = '─',
  color = Semantic.Muted,
  dimColor = true,
  marginTop = 0,
  marginBottom = 0,
  label,
}) => (
  <Box marginTop={marginTop} marginBottom={marginBottom} width="100%">
    <Text dimColor={dimColor} color={color}>
      {label
        ? `${char.repeat(3)} ${label} ${char.repeat(Math.max(0, width - label.length - 5))}`
        : char.repeat(width)}
    </Text>
  </Box>
);