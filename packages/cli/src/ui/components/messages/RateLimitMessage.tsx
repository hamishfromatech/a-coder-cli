/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Text, Box } from 'ink';
import { Semantic } from '../../colors.js';
import { Icons } from '../../utils/icons.js';

interface RateLimitMessageProps {
  retryAfterMs: number;
  text: string;
}

/**
 * Displays a rate limit error with a countdown timer.
 * Shows "Rate limited — retrying in Xs..." and counts down
 * until the retry window expires.
 */
export const RateLimitMessage: React.FC<RateLimitMessageProps> = ({
  retryAfterMs,
  text,
}) => {
  const [secondsLeft, setSecondsLeft] = useState(
    Math.ceil(retryAfterMs / 1000),
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    setSecondsLeft(Math.ceil(retryAfterMs / 1000));

    intervalRef.current = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [retryAfterMs]);

  const countdownText =
    secondsLeft > 0
      ? `Rate limited \u2014 retrying in ${secondsLeft}s...`
      : `Rate limit expired, retrying...`;

  return (
    <Box
      borderStyle="single"
      borderColor={Semantic.Warning}
      flexDirection="column"
      paddingX={1}
      marginY={1}
    >
      <Box flexDirection="row">
        <Box paddingRight={1}>
          <Text bold color={Semantic.Warning}>{Icons.WarningLabel}</Text>
        </Box>
        <Box flexGrow={1}>
          <Text wrap="wrap" color={Semantic.Warning}>
            {countdownText}
          </Text>
        </Box>
      </Box>
      <Box paddingX={1}>
        <Text dimColor wrap="wrap">
          {text.length > 200 ? text.substring(0, 200) + '...' : text}
        </Text>
      </Box>
    </Box>
  );
};