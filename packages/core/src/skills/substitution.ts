/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Supported substitution patterns in skill content:
 *
 * $ARGUMENTS - All arguments as a single string
 * $ARGUMENTS[N] - Specific argument by 1-based index
 * $N - Shorthand for $ARGUMENTS[N] (1-based index)
 * ${CLAUDE_SESSION_ID} - Current session ID
 *
 * @param content - The skill content with placeholders
 * @param args - Array of argument strings
 * @param sessionId - The current session ID
 * @returns Content with all substitutions applied
 */
export function substituteArguments(
  content: string,
  args: string[],
  sessionId: string,
): string {
  let result = content;

  // Substitute ${CLAUDE_SESSION_ID}
  result = result.replace(/\$\{CLAUDE_SESSION_ID\}/g, sessionId);

  // Substitute $ARGUMENTS (all arguments as a single string)
  result = result.replace(/\$ARGUMENTS\b/g, args.join(' '));

  // Substitute $ARGUMENTS[N] and $N patterns (1-based indexing)
  result = result.replace(/\$ARGUMENTS\[(\d+)\]/g, (_match, index) => {
    const i = parseInt(index, 10) - 1; // Convert to 0-based index
    return args[i] || '';
  });

  // Substitute $N pattern (1-based indexing)
  result = result.replace(/\$(\d+)/g, (_match, index) => {
    const i = parseInt(index, 10) - 1; // Convert to 0-based index
    return args[i] || '';
  });

  return result;
}

/**
 * Parse arguments from a command string
 *
 * Handles quoted strings and escaping similar to shell parsing
 *
 * @param argsString - The arguments string to parse
 * @returns Array of parsed arguments
 */
export function parseArguments(argsString: string): string[] {
  if (!argsString || !argsString.trim()) {
    return [];
  }

  const args: string[] = [];
  let current = '';
  let inQuote = false;
  let quoteChar = '';
  let escapeNext = false;

  for (let i = 0; i < argsString.length; i++) {
    const char = argsString[i];

    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      escapeNext = true;
      continue;
    }

    if ((char === '"' || char === "'") && !inQuote) {
      inQuote = true;
      quoteChar = char;
      continue;
    }

    if (char === quoteChar && inQuote) {
      inQuote = false;
      quoteChar = '';
      continue;
    }

    if (char === ' ' && !inQuote) {
      if (current.trim()) {
        args.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  // Add the last argument if there is one
  if (current.trim()) {
    args.push(current);
  }

  return args;
}

/**
 * Validate argument placeholders in content against provided args
 *
 * @param content - The content with placeholders
 * @param args - Array of arguments
 * @returns Object with validation result and missing indices
 */
export function validateArgumentPlaceholders(
  content: string,
  args: string[],
): { valid: boolean; missingIndices: number[] } {
  const missingIndices: number[] = [];

  // Find all $ARGUMENTS[N] and $N patterns
  const pattern = /\$(?:ARGUMENTS\[)?(\d+)\]?/g;
  let match;

  while ((match = pattern.exec(content)) !== null) {
    const index = parseInt(match[1], 10); // 1-based index
    if (index > args.length) {
      missingIndices.push(index);
    }
  }

  return {
    valid: missingIndices.length === 0,
    missingIndices,
  };
}