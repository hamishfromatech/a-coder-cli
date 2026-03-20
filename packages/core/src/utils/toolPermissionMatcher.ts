/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Utility class for matching tool names and arguments against permission patterns.
 * Supports patterns like:
 * - "ToolName" - matches exact tool name
 * - "ToolName(arg1)" - matches tool with specific argument value
 * - "ToolName(arg1, arg2)" - matches tool with multiple argument values
 * - "ToolName(*)" - matches any arguments
 * - "Bash(git:*)" - matches Bash tool with git commands
 */
export class ToolPermissionMatcher {
  /**
   * Match a tool name and input against a pattern.
   * @param toolName The name of the tool to match
   * @param toolInput The arguments passed to the tool
   * @param pattern The pattern to match against
   * @returns true if the pattern matches, false otherwise
   */
  static matches(
    toolName: string,
    toolInput: Record<string, unknown>,
    pattern: string,
  ): boolean {
    // Exact tool name match
    if (pattern === toolName) {
      return true;
    }

    // Pattern with arguments: ToolName(arg1) or ToolName(*)
    const patternMatch = pattern.match(/^(\w+)\((.*)\)$/);
    if (patternMatch) {
      const [, patternToolName, patternArgs] = patternMatch;
      if (patternToolName !== toolName) {
        return false;
      }

      // Wildcard matches all args
      if (patternArgs === '*') {
        return true;
      }

      // Parse and match arguments
      const patternArgList = this.parsePatternArgs(patternArgs);
      const toolArgValues = this.extractToolArgValues(toolInput);

      // Check if all pattern args are present in tool args
      return patternArgList.every((pa) =>
        toolArgValues.some((ta) => ta.includes(pa) || ta === pa),
      );
    }

    // Regex pattern for advanced matching (if pattern contains regex chars)
    if (pattern.includes('[') || pattern.includes('\\') || pattern.includes('|')) {
      try {
        const regex = new RegExp(pattern);
        return regex.test(toolName);
      } catch {
        // Invalid regex, fall through to false
      }
    }

    return false;
  }

  /**
   * Parse pattern arguments string into array of argument values.
   * Handles quoted strings and comma separation.
   */
  static parsePatternArgs(argsString: string): string[] {
    const args: string[] = [];
    let current = '';
    let inQuotes = false;

    for (const char of argsString) {
      if (char === '"' || char === "'") {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        if (current.trim()) {
          args.push(current.trim());
        }
        current = '';
      } else {
        current += char;
      }
    }
    if (current.trim()) {
      args.push(current.trim());
    }

    return args;
  }

  /**
   * Extract string values from tool input for pattern matching.
   * Recursively extracts strings from nested objects and arrays.
   */
  static extractToolArgValues(args: Record<string, unknown>): string[] {
    const values: string[] = [];
    for (const value of Object.values(args)) {
      if (typeof value === 'string') {
        values.push(value);
      } else if (Array.isArray(value)) {
        values.push(...value.filter((v): v is string => typeof v === 'string'));
      } else if (typeof value === 'object' && value !== null) {
        // Recursively extract from nested objects
        values.push(...this.extractToolArgValues(value as Record<string, unknown>));
      }
    }
    return values;
  }

  /**
   * Check if a tool is in a list of allowed patterns.
   * @param toolName The name of the tool
   * @param toolInput The arguments passed to the tool
   * @param patterns Array of patterns to check against
   * @returns true if any pattern matches, false otherwise
   */
  static matchesAny(
    toolName: string,
    toolInput: Record<string, unknown>,
    patterns: string[],
  ): boolean {
    return patterns.some((pattern) => this.matches(toolName, toolInput, pattern));
  }

  /**
   * Check if a tool is excluded by a list of patterns.
   * @param toolName The name of the tool
   * @param toolInput The arguments passed to the tool
   * @param patterns Array of exclusion patterns
   * @returns The first matching pattern if excluded, undefined otherwise
   */
  static findExclusionPattern(
    toolName: string,
    toolInput: Record<string, unknown>,
    patterns: string[],
  ): string | undefined {
    for (const pattern of patterns) {
      if (this.matches(toolName, toolInput, pattern)) {
        return pattern;
      }
    }
    return undefined;
  }
}