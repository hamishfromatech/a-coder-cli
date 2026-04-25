/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Semantic } from '../../colors.js';

interface SeparatorProps {
  /** Optional label text displayed at the start of the separator */
  label?: string;
  /** Color for the separator line (default: muted) */
  color?: string;
  /** Whether to add vertical margin (default: true) */
  withMargin?: boolean;
  /** Width of the separator (default: 100%) */
  width?: number | string;
}

/**
 * A thin horizontal separator line for visual rhythm between UI sections.
 * Renders a dim line that spans the available width, with an optional label.
 */
export const Separator: React.FC<SeparatorProps> = ({
  label,
  color,
  withMargin = true,
  width = '100%',
}) => {
  const lineColor = color || Semantic.Muted;

  return (
    <Box
      flexDirection="row"
      width={width}
      marginTop={withMargin ? 1 : 0}
      marginBottom={withMargin ? 1 : 0}
    >
      {label ? (
        <>
          <Text dimColor color={lineColor}>
            {'─'.repeat(2)}
          </Text>
          <Text dimColor color={lineColor}>
            {' '}
          </Text>
          <Text dimColor color={lineColor}>
            {label}
          </Text>
          <Text dimColor color={lineColor}>
            {' '}
          </Text>
          <Box flexGrow={1}>
            <Text dimColor color={lineColor}>
              {'─'.repeat(20)}
            </Text>
          </Box>
        </>
      ) : (
        <Text dimColor color={lineColor}>
          {'─'.repeat(40)}
        </Text>
      )}
    </Box>
  );
};
