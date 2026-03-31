/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Semantic } from '../colors.js';
import { ApprovalMode } from '@a-coder/core';

interface AutoAcceptIndicatorProps {
  approvalMode: ApprovalMode;
}

export const AutoAcceptIndicator: React.FC<AutoAcceptIndicatorProps> = ({
  approvalMode,
}) => {
  let textColor = '';
  let textContent = '';
  let subText = '';

  switch (approvalMode) {
    case ApprovalMode.AUTO_EDIT:
      textColor = Semantic.Success;
      textContent = 'accepting edits';
      subText = ' (shift + tab to toggle)';
      break;
    case ApprovalMode.YOLO:
      textColor = Semantic.Error;
      textContent = 'YOLO mode';
      subText = ' (ctrl + y to toggle)';
      break;
    case ApprovalMode.DEFAULT:
    default:
      break;
  }

  return (
    <Box>
      <Text color={textColor}>
        {textContent}
        {subText && <Text color={Semantic.Muted}>{subText}</Text>}
      </Text>
    </Box>
  );
};
