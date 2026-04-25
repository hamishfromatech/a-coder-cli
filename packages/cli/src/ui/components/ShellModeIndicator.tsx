/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Semantic } from '../colors.js';

export const ShellModeIndicator: React.FC = () => (
  <Box>
    <Text color={Semantic.Warning} dimColor>
      shell mode
      <Text color={Semantic.Muted}> esc to exit</Text>
    </Text>
  </Box>
);
