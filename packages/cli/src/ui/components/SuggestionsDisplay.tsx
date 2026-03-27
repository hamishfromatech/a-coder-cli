/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from 'ink';
import { Colors } from '../colors.js';

export interface Suggestion {
  label: string;
  value: string;
  description?: string;
  /** Category for grouping (optional) */
  category?: string;
  /** Argument hint to display (optional) */
  argumentHint?: string;
  /** Usage example (optional) */
  example?: string;
}

interface SuggestionsDisplayProps {
  suggestions: Suggestion[];
  activeIndex: number;
  isLoading: boolean;
  width: number;
  scrollOffset: number;
  userInput: string;
  /** Whether to group suggestions by category */
  groupByCategory?: boolean;
}

export const MAX_SUGGESTIONS_TO_SHOW = 8;

/**
 * Get a color for a category
 */
function getCategoryColor(category?: string): string {
  switch (category?.toLowerCase()) {
    case 'agent':
      return Colors.AccentPurple;
    case 'skill':
      return Colors.AccentGreen;
    case 'plugin':
      return Colors.AccentYellow;
    case 'session':
      return Colors.AccentBlue;
    case 'config':
      return Colors.Gray;
    case 'memory':
      return Colors.AccentCyan;
    default:
      return Colors.Foreground;
  }
}

export function SuggestionsDisplay({
  suggestions,
  activeIndex,
  isLoading,
  width,
  scrollOffset,
  userInput,
  groupByCategory = false,
}: SuggestionsDisplayProps) {
  if (isLoading) {
    return (
      <Box paddingX={1} width={width}>
        <Text color={Colors.Gray}>Loading suggestions...</Text>
      </Box>
    );
  }

  if (suggestions.length === 0) {
    return null; // Don't render anything if there are no suggestions
  }

  // Calculate the visible slice based on scrollOffset
  const startIndex = scrollOffset;
  const endIndex = Math.min(
    scrollOffset + MAX_SUGGESTIONS_TO_SHOW,
    suggestions.length,
  );
  const visibleSuggestions = suggestions.slice(startIndex, endIndex);

  // Group suggestions by category if enabled
  if (groupByCategory && suggestions.some((s) => s.category)) {
    const grouped: Map<string, Suggestion[]> = new Map();
    for (const suggestion of suggestions) {
      const category = suggestion.category || 'other';
      if (!grouped.has(category)) {
        grouped.set(category, []);
      }
      grouped.get(category)!.push(suggestion);
    }

    return (
      <Box flexDirection="column" paddingX={1} width={width}>
        {scrollOffset > 0 && <Text color={Colors.Gray}>▲</Text>}

        {Array.from(grouped.entries()).map(([category, categorySuggestions]) => {
          const color = getCategoryColor(category);

          return (
            <Box key={category} flexDirection="column" marginTop={category !== grouped.keys().next().value ? 1 : 0}>
              {category !== 'other' && (
                <Text color={Colors.Gray} dimColor>
                  {category.charAt(0).toUpperCase() + category.slice(1)}
                </Text>
              )}
              {categorySuggestions
                .filter((s) => {
                  const idx = suggestions.indexOf(s);
                  return idx >= startIndex && idx < endIndex;
                })
                .map((suggestion, localIndex) => {
                  const originalIndex = suggestions.indexOf(suggestion);
                  const isActive = originalIndex === activeIndex;

                  return (
                    <Box key={`${suggestion.value}-${localIndex}`} width={width}>
                      <Box flexDirection="row">
                        {userInput.startsWith('/') ? (
                          <Box width={18} flexShrink={0}>
                            <Text
                              bold={isActive}
                              color={isActive ? Colors.AccentPurple : color}
                            >
                              {suggestion.label}
                            </Text>
                          </Box>
                        ) : (
                          <Text
                            bold={isActive}
                            color={isActive ? Colors.AccentPurple : Colors.Foreground}
                          >
                            {suggestion.label}
                          </Text>
                        )}
                        {suggestion.description && (
                          <Box flexGrow={1}>
                            <Text
                              color={isActive ? Colors.Foreground : Colors.Gray}
                              wrap="wrap"
                            >
                              {suggestion.description}
                            </Text>
                          </Box>
                        )}
                      </Box>
                      {isActive && suggestion.argumentHint && (
                        <Text color={Colors.AccentCyan} dimColor>
                          {' '}
                          {suggestion.argumentHint}
                        </Text>
                      )}
                    </Box>
                  );
                })}
            </Box>
          );
        })}

        {endIndex < suggestions.length && <Text color={Colors.Gray}>▼</Text>}
        {suggestions.length > MAX_SUGGESTIONS_TO_SHOW && (
          <Text color={Colors.Gray}>({activeIndex + 1}/{suggestions.length})</Text>
        )}
      </Box>
    );
  }

  // Standard non-grouped display
  return (
    <Box flexDirection="column" paddingX={1} width={width}>
      {scrollOffset > 0 && <Text color={Colors.Foreground}>▲</Text>}

      {visibleSuggestions.map((suggestion, index) => {
        const originalIndex = startIndex + index;
        const isActive = originalIndex === activeIndex;
        const textColor = isActive ? Colors.AccentPurple : Colors.Gray;

        return (
          <Box key={`${suggestion.value}-${originalIndex}`} width={width} flexDirection="column">
            <Box flexDirection="row">
              {userInput.startsWith('/') ? (
                // Command mode - use box model for alignment
                <Box width={20} flexShrink={0}>
                  <Text color={textColor} bold={isActive}>
                    {suggestion.label}
                  </Text>
                </Box>
              ) : (
                // Regular mode
                <Text color={textColor} bold={isActive}>
                  {suggestion.label}
                </Text>
              )}
              {suggestion.description && (
                <Box flexGrow={1}>
                  <Text color={textColor} wrap="wrap">
                    {suggestion.description}
                  </Text>
                </Box>
              )}
            </Box>
            {/* Show argument hint for active suggestion */}
            {isActive && suggestion.argumentHint && (
              <Text color={Colors.AccentCyan} dimColor>
                {'  '}{suggestion.argumentHint}
              </Text>
            )}
            {/* Show example for active suggestion */}
            {isActive && suggestion.example && (
              <Text color={Colors.Gray} dimColor>
                {'  '}{suggestion.example}
              </Text>
            )}
          </Box>
        );
      })}
      {endIndex < suggestions.length && <Text color={Colors.Gray}>▼</Text>}
      {suggestions.length > MAX_SUGGESTIONS_TO_SHOW && (
        <Text color={Colors.Gray}>
          ({activeIndex + 1}/{suggestions.length})
        </Text>
      )}
    </Box>
  );
}