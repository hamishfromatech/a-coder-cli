/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
import { type PartListUnion } from '@google/genai';

interface QueryQueueListProps {
  queue: Array<{ query: PartListUnion; prompt_id?: string }>;
}

export const QueryQueueList = ({ queue }: QueryQueueListProps) => {
  if (queue.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" paddingX={1} marginBottom={1}>
      {queue.map((item, index) => (
        <Box key={index} marginLeft={1}>
          <Text color={Colors.Gray}>
            ○ Queued: {typeof item.query === 'string' ? item.query : '[Binary/Tool Response]'}
          </Text>
        </Box>
      ))}
    </Box>
  );
};
