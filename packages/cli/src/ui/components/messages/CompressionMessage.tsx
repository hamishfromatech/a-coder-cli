import React from 'react';
import { Box, Text } from 'ink';
import { CompressionProps } from '../../types.js';
import { Semantic } from '../../colors.js';
import { useAnimation } from '../../hooks/useAnimation.js';

const COMPRESS_FRAMES = ['⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷'];

export interface CompressionDisplayProps {
  compression: CompressionProps;
}

export const CompressionMessage: React.FC<CompressionDisplayProps> = ({
  compression,
}) => {
  const { frame } = useAnimation(80, compression.isPending);
  const text = compression.isPending
    ? 'Compressing chat history...'
    : `Chat history compressed from ${compression.originalTokenCount ?? 'unknown'}`
      + ` to ${compression.newTokenCount ?? 'unknown'} tokens.`;

  return (
    <Box flexDirection="row" marginY={1} paddingX={1}>
      <Box marginRight={1}>
        {compression.isPending ? (
          <Text color={Semantic.Primary}>{COMPRESS_FRAMES[frame % COMPRESS_FRAMES.length]}</Text>
        ) : (
          <Text color={Semantic.Success}>✓</Text>
        )}
      </Box>
      <Box>
        <Text color={compression.isPending ? Semantic.Primary : Semantic.Success}>
          {text}
        </Text>
      </Box>
    </Box>
  );
};