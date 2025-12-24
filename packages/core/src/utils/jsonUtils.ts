/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Robustly parse tool call arguments that might be malformed.
 * Handles cases like multiple JSON objects, trailing text, or missing outer braces.
 */
export function robustParseToolArguments(input: string): Record<string, unknown> {
  const trimmed = input.trim();
  try {
    return JSON.parse(trimmed);
  } catch (error: any) {
    // Robust parsing attempt:
    // 1. Try to find a valid JSON object by trying different end points
    const startIdx = trimmed.indexOf('{');
    if (startIdx !== -1) {
      let endIdx = trimmed.lastIndexOf('}');
      while (endIdx > startIdx) {
        try {
          return JSON.parse(trimmed.substring(startIdx, endIdx + 1));
        } catch (e) {
          // Try the previous '}'
          endIdx = trimmed.lastIndexOf('}', endIdx - 1);
        }
      }
    }

    // 2. If still not parsed, try using the position from the error message
    if (
      error &&
      typeof error.message === 'string' &&
      error.message.includes('at position')
    ) {
      const match = error.message.match(/at position (\d+)/);
      if (match) {
        const pos = parseInt(match[1], 10);
        try {
          const candidate = trimmed.substring(0, pos).trim();
          const result = JSON.parse(candidate);
          if (
            typeof result === 'object' &&
            result !== null &&
            !Array.isArray(result)
          ) {
            return result;
          } else {
            // If it's a valid JSON but not an object, wrap it
            return { value: result };
          }
        } catch (e) {
          // Continue to error logging
        }
      }
    }

    console.error(
      'Failed to parse tool call arguments even with robust parsing:',
      error,
    );
    console.error('Raw arguments:', trimmed);
    return {};
  }
}
