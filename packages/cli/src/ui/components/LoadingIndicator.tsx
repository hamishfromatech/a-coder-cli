/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { ThoughtSummary } from '@a-coder/core';
import React from 'react';
import { Box, Text } from 'ink';
import { Semantic } from '../colors.js';
import { useStreamingContext } from '../contexts/StreamingContext.js';
import { StreamingState } from '../types.js';
import { GeminiRespondingSpinner } from './GeminiRespondingSpinner.js';

interface LoadingIndicatorProps {
  currentLoadingPhrase?: string;
  elapsedTime: number;
  rightContent?: React.ReactNode;
  thought?: ThoughtSummary | null;
  showThinking?: boolean;
}

/**
 * Global loading indicator shown during LLM streaming.
 * Compact design — per-tool-use spinners are shown inline in ToolMessage
 * components, so this only shows for overall query state (thinking, waiting).
 */
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

  const hasThought = thought?.description;
  const isWaiting = streamingState === StreamingState.WaitingForConfirmation;

  return (
    <Box marginTop={1} flexDirection="column">
      {/* Main loading line */}
      {(currentLoadingPhrase || thought?.subject) && (
        <Box>
          <Box marginRight={2}>
            <GeminiRespondingSpinner
              nonRespondingDisplay={isWaiting ? '⠏' : undefined}
            />
          </Box>
          <Text
            color={isWaiting ? Semantic.Warning : Semantic.Primary}
            dimColor={!isWaiting}
          >
            {currentLoadingPhrase || thought?.subject}
          </Text>
          {rightContent && <Box marginLeft={2}>{rightContent}</Box>}
        </Box>
      )}

      {/* Reasoning hidden hint */}
      {hasThought && !showThinking && (
        <Box marginLeft={4} marginTop={0}>
          <Text color={Semantic.Muted} dimColor>
            reasoning hidden (ctrl+o)
          </Text>
        </Box>
      )}

      {/* Thought description panel */}
      {showThinking && hasThought && (
        <Box
          marginLeft={2}
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