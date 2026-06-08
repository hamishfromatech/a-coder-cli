import React from 'react';
import { Box, Text } from 'ink';
import { ApprovalMode } from '@a-coder/core';
import { Semantic, contrastText } from '../colors.js';

interface AutoAcceptIndicatorProps {
  approvalMode: ApprovalMode;
}

export const AutoAcceptIndicator: React.FC<AutoAcceptIndicatorProps> = ({
  approvalMode,
}) => {
  const isYolo = approvalMode === ApprovalMode.YOLO;
  const color = isYolo ? Semantic.Error : Semantic.Success;
  const label = isYolo ? 'YOLO' : 'AE';

  return (
    <Box backgroundColor={color} paddingX={1}>
      <Text color={contrastText(color)} bold>{label}</Text>
    </Box>
  );
};