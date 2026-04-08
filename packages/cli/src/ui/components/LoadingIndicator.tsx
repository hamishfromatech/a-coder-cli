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
      {/* Main loading line with spinner */}
      <Box>
        <Box marginRight={2}>
          <GeminiRespondingSpinner
            nonRespondingDisplay={isWaiting ? '⠏' : undefined}
          />
        </Box>
        {primaryText && (
          <Text
            color={isWaiting ? Semantic.Warning : Semantic.Primary}
            bold={!isWaiting}
          >
            {primaryText}
          </Text>
        )}
        {/* Right-aligned content (e.g., model switch notification) */}
        {rightContent && <Box marginLeft={2}>{rightContent}</Box>}
      </Box>

      {/* Secondary info: elapsed time, cancel hint, thought indicator */}
      {!isWaiting && (elapsedTime >= 3 || hasThought) && (
        <Box marginLeft={4} marginTop={0} flexDirection="row">
          <Text color={Semantic.Primary} dimColor>
            {elapsedTime >= 3 && `${Math.round(elapsedTime)}s`}
            {elapsedTime >= 3 && hasThought && ' · '}
            {hasThought && !showThinking && 'Reasoning hidden (ctrl+o)'}
            {hasThought && showThinking && 'Showing reasoning'}
            {!hasThought && elapsedTime >= 3 && elapsedTime < 30 && 'esc to cancel'}
            {!hasThought && elapsedTime >= 30 && 'still working... esc to cancel'}
          </Text>
        </Box>
      )}

      {/* Thought description - show only when explicitly requested */}
      {showThinking && hasThought && (
        <Box
          marginLeft={4}
          marginTop={0}
          paddingY={1}
          paddingX={2}
          borderStyle="round"
          borderColor={Semantic.Secondary}
        >
          <Text color={Semantic.Secondary} wrap="wrap">
            {thought.description}
          </Text>
        </Box>
      )}
    </Box>
  );
};
