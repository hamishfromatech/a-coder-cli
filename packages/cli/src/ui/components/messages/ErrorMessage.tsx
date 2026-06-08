import React from 'react';
import { Text, Box } from 'ink';
import { Semantic } from '../../colors.js';
import { Icons } from '../../utils/icons.js';
import { CONTENT } from '../../constants.js';

interface ErrorMessageProps {
  text: string;
  verbose?: boolean;
}

function truncateError(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

export const ErrorMessage: React.FC<ErrorMessageProps> = ({ text, verbose }) => {
  const maxLen = verbose ? CONTENT.maxVerboseErrorLength : CONTENT.maxErrorLength;
  const displayText = truncateError(text, maxLen);

  return (
    <Box flexDirection="row" marginY={1} paddingX={1}>
      <Box flexShrink={0} width={1} marginRight={1}>
        <Text bold color={Semantic.Error}>{'▍'}</Text>
      </Box>
      <Box paddingRight={1}>
        <Text bold color={Semantic.Error}>{Icons.ErrorLabel}</Text>
      </Box>
      <Box flexGrow={1}>
        <Text wrap="wrap" color={Semantic.Error}>
          {displayText}
        </Text>
      </Box>
    </Box>
  );
};