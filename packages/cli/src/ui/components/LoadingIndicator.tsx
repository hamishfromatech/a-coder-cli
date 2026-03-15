/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ThoughtSummary } from '@a-coder/core';
import React from 'react';
import { Box, Text } from 'ink';
import { Colors, Semantic } from '../colors.js';
import { useStreamingContext } from '../contexts/StreamingContext.js';
import { StreamingState } from '../types.js';
import { GeminiRespondingSpinner } from './GeminiRespondingSpinner.js';
import { formatDuration } from '../utils/formatters.js';

interface LoadingIndicatorProps {
  currentLoadingPhrase?: string;
  elapsedTime: number;
  rightContent?: React.ReactNode;
  thought?: ThoughtSummary | null;
  showThinking?: boolean;
}

export const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({
  currentLoadingPhrase,
  elapsedTime,
  rightContent,
  thought,
  showThinking = false,
}) => {
  const streamingState = useStreamingContext();

  if (streamingState === StreamingState.Idle) {
    return null;
  }

  const primaryText = currentLoadingPhrase || thought?.subject;
  const hasThought = thought?.description;
  const isWaiting = streamingState === StreamingState.WaitingForConfirmation;

  return (
    <Box marginTop={1} flexDirection="column">
      {/* Main loading line - simplified */}
      <Box>
        <Box marginRight={1}>
          <GeminiRespondingSpinner
            nonRespondingDisplay={isWaiting ? '⠏' : ''}
          />
        </Box>
        {primaryText && (
          <Text color={isWaiting ? Semantic.Warning : Semantic.Primary}>
            {primaryText}
          </Text>
        )}
      </Box>

      {/* Secondary info on separate line - only show relevant info */}
      {!isWaiting && (
        <Box marginLeft={3} marginTop={0} flexDirection="row">
          <Text color={Semantic.Muted}>
            {elapsedTime >= 5 && `${elapsedTime}s elapsed `}
            {hasThought && !showThinking && '| ctrl+o for reasoning '}
            | esc to cancel
          </Text>
        </Box>
      )}

      {/* Thought description - show only when explicitly requested */}
      {showThinking && hasThought && (
        <Box marginLeft={3} marginTop={0}>
          <Text italic color={Semantic.Muted} wrap="wrap">
            {thought.description}
          </Text>
        </Box>
      )}

      {/* Right content if needed */}
      {rightContent && <Box>{rightContent}</Box>}
    </Box>
  );
};
