/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Dynamic command patterns to replace:
 *
 * !`command` - Execute command and replace with stdout
 *
 * Multiple commands can be used in the same content
 *
 * @param content - The skill content with dynamic command placeholders
 * @param cwd - Current working directory for command execution
 * @param signal - Abort signal to cancel execution
 * @returns Content with all commands executed and replaced
 * @throws Error if command execution fails
 */
export async function processDynamicCommands(
  content: string,
  cwd: string,
  signal: AbortSignal,
): Promise<string> {
  // Pattern to match !`command` where command can be multi-line
  const pattern = /!`((?:[^`]|`(?!`))*)`/gs;

  let result = content;
  let match: RegExpExecArray | null;

  // Process each dynamic command
  while ((match = pattern.exec(content)) !== null) {
    // Check if we should abort
    if (signal.aborted) {
      throw new Error('Command execution aborted');
    }

    const fullMatch = match[0];
    const command = match[1].trim();

    try {
      // Execute the command
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        timeout: 30000, // 30 second timeout per command
        signal,
      });

      // Use stdout, fallback to empty string
      const output = stdout.trim();

      // Replace the placeholder with the output
      result = result.replace(fullMatch, output);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      throw new Error(`Dynamic command execution failed: "${command}"\n${errorMessage}`);
    }
  }

  return result;
}

/**
 * Extract all dynamic commands from content without executing them
 *
 * @param content - The skill content to scan
 * @returns Array of command strings found in the content
 */
export function extractDynamicCommands(content: string): string[] {
  const commands: string[] = [];
  const pattern = /!`((?:[^`]|`(?!`))*)`/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(content)) !== null) {
    commands.push(match[1].trim());
  }

  return commands;
}

/**
 * Check if content contains any dynamic commands
 *
 * @param content - The content to check
 * @returns True if content contains dynamic commands
 */
export function hasDynamicCommands(content: string): boolean {
  return /!`/.test(content);
}