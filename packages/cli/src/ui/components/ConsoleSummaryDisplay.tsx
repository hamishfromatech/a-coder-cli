/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Semantic } from '../colors.js';
import { getMessageIcon } from '../utils/icons.js';

interface ConsoleSummaryDisplayProps {
  errorCount: number;
  // logCount is not currently in the plan to be displayed in summary
}

export const ConsoleSummaryDisplay: React.FC<ConsoleSummaryDisplayProps> = ({
  errorCount,
}) => {
  return (
    <Box>
      {errorCount > 0 && (
        <Text color={Semantic.Error}>
          {getMessageIcon('error')} {errorCount} error{errorCount > 1 ? 's' : ''}{' '}
          <Text color={Semantic.Muted}>(ctrl+e for details)</Text>
        </Text>
      )}
    </Box>
  );
};