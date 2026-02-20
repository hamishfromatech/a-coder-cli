/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Subagent CLI Entry Point
 *
 * This is a lightweight CLI mode for subagent processes.
 * It receives configuration via environment variables and executes
 * a single task, then outputs the result as JSON and exits.
 */

import {
  SUBAGENT_MODE_ENV_VAR,
  SUBAGENT_CONFIG_ENV_VAR,
  SubagentMessageType,
  SubagentConfig,
  SubagentResult,
  Config,
  sessionId,
} from '@a-coder/core';
import { loadSettings, LoadedSettings } from './config/settings.js';
import { loadExtensions, Extension } from './config/extension.js';
import { parseArguments, loadCliConfig } from './config/config.js';

// Verify we're in subagent mode
if (process.env[SUBAGENT_MODE_ENV_VAR] !== 'true') {
  console.error('Error: This entry point is for subagent mode only.');
  console.error('Use the main CLI entry point for interactive mode.');
  process.exit(1);
}

// Parse config from environment
const configJson = process.env[SUBAGENT_CONFIG_ENV_VAR];
if (!configJson) {
  console.error('Error: No subagent configuration provided.');
  process.exit(1);
}

let subagentConfig: SubagentConfig;
try {
  subagentConfig = JSON.parse(configJson);
} catch (e) {
  console.error('Error: Failed to parse subagent configuration.');
  process.exit(1);
}

/**
 * Send a message to the parent process
 */
function sendMessage(type: SubagentMessageType, payload: unknown): void {
  if (process.send) {
    process.send({ type, payload });
  }
}

/**
 * Send a progress update to the parent process
 */
function sendProgress(message: string, percentage?: number): void {
  sendMessage(SubagentMessageType.PROGRESS, { message, percentage });
}

/**
 * Send the final result to the parent process and exit
 */
function sendResult(result: SubagentResult): void {
  sendMessage(SubagentMessageType.RESULT, result);
  // Give the parent process time to receive the message
  setTimeout(() => {
    process.exit(result.success ? 0 : 1);
  }, 100);
}

/**
 * Send an error to the parent process and exit
 */
function sendError(message: string, stack?: string): void {
  sendMessage(SubagentMessageType.ERROR, { message, stack });
  setTimeout(() => {
    process.exit(1);
  }, 100);
}

/**
 * Main subagent execution
 */
async function runSubagent(): Promise<void> {
  const startTime = Date.now();
  let config: Config | null = null;
  const filesRead: string[] = [];
  const filesModified: string[] = [];
  const commandsExecuted: string[] = [];
  const errors: string[] = [];

  try {
    sendProgress('Initializing subagent...', 0);

    // Load settings (minimal, non-interactive)
    const workspaceRoot = subagentConfig.workingDir || process.cwd();
    const settings = loadSettings(workspaceRoot);

    if (settings.errors.length > 0) {
      sendError(`Settings errors: ${settings.errors.join(', ')}`);
      return;
    }

    // Load extensions
    const extensions = loadExtensions(workspaceRoot);

    // Parse CLI args (use defaults, non-interactive)
    const argv = await parseArguments();

    // Load config
    config = await loadCliConfig(
      settings.merged,
      extensions,
      sessionId,
      argv,
    );

    // Override model if specified
    if (subagentConfig.model) {
      config.setModel(subagentConfig.model);
    }

    sendProgress('Initializing AI client...', 10);

    // Initialize the config
    await config.initialize();

    sendProgress('Preparing task context...', 20);

    // Build the task prompt with context
    let taskPrompt = subagentConfig.task;

    if (subagentConfig.context) {
      taskPrompt = `Context:\n${subagentConfig.context}\n\nTask:\n${subagentConfig.task}`;
    }

    // Add context files if specified
    if (subagentConfig.contextFiles && subagentConfig.contextFiles.length > 0) {
      const fs = await import('fs/promises');
      const fileContents: string[] = [];

      for (const filePath of subagentConfig.contextFiles) {
        try {
          const content = await fs.readFile(filePath, 'utf-8');
          fileContents.push(`--- ${filePath} ---\n${content}\n`);
          filesRead.push(filePath);
        } catch (e) {
          errors.push(`Could not read context file ${filePath}: ${e}`);
        }
      }

      if (fileContents.length > 0) {
        taskPrompt = `Context Files:\n${fileContents.join('\n')}\n\n${taskPrompt}`;
      }
    }

    // Add subagent-specific instructions
    taskPrompt = `${taskPrompt}\n\n---\nYou are a subagent working on a specific task. Guidelines:\n1. Focus only on the assigned task - do not expand scope\n2. Be concise in your responses\n3. When complete, provide a clear summary of what was done\n4. If you cannot complete the task, explain why clearly\n5. Track any files you read or modify\n6. Track any shell commands you execute`;

    sendProgress('Executing task...', 30);

    // Get the Gemini client
    const client = config.getGeminiClient();
    if (!client) {
      sendError('Failed to initialize AI client');
      return;
    }

    // Execute the task
    let responseText = '';
    const abortController = new AbortController();
    
    // Set up timeout
    const timeout = subagentConfig.timeout || 300000;
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, timeout);

    try {
      const stream = client.sendMessageStream(
        [{ text: taskPrompt }],
        abortController.signal,
        sessionId,
      );

      for await (const event of stream) {
        if (abortController.signal.aborted) {
          break;
        }

        if (event.type === 'content') {
          responseText += event.value;
        } else if (event.type === 'tool_call_request') {
          // Track tool usage for reporting
          const toolName = event.value.name;
          const toolArgs = event.value.args as Record<string, unknown>;
          sendProgress(`Executing tool: ${toolName}`, undefined);

          // Track file operations
          if (toolName === 'read_file' && toolArgs?.absolute_path) {
            filesRead.push(toolArgs.absolute_path as string);
          } else if (toolName === 'read_many_files' && toolArgs?.paths) {
            filesRead.push(...(toolArgs.paths as string[]));
          } else if (toolName === 'write_file' && toolArgs?.file_path) {
            filesModified.push(toolArgs.file_path as string);
          } else if (toolName === 'edit' && toolArgs?.file_path) {
            filesModified.push(toolArgs.file_path as string);
          } else if (toolName === 'shell' && toolArgs?.command) {
            commandsExecuted.push(toolArgs.command as string);
          }
        } else if (event.type === 'error') {
          errors.push(event.value.error.message);
        }
      }
    } finally {
      clearTimeout(timeoutId);
    }

    sendProgress('Finalizing...', 90);

    // Build the result
    const duration = Date.now() - startTime;
    const result: SubagentResult = {
      success: errors.length === 0,
      summary: extractSummary(responseText) || 'Task completed',
      details: responseText,
      filesRead: filesRead.length > 0 ? filesRead : undefined,
      filesModified: filesModified.length > 0 ? filesModified : undefined,
      commandsExecuted: commandsExecuted.length > 0 ? commandsExecuted : undefined,
      errors: errors.length > 0 ? errors : undefined,
      duration,
    };

    sendProgress('Complete', 100);
    sendResult(result);

  } catch (error) {
    const duration = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;

    sendResult({
      success: false,
      summary: 'Subagent failed with an error',
      details: errorMessage,
      errors: [errorMessage],
      filesRead: filesRead.length > 0 ? filesRead : undefined,
      filesModified: filesModified.length > 0 ? filesModified : undefined,
      commandsExecuted: commandsExecuted.length > 0 ? commandsExecuted : undefined,
      duration,
    });
  }
}

/**
 * Extract a brief summary from the response text
 */
function extractSummary(text: string): string | null {
  // Try to find a summary section
  const summaryMatch = text.match(/(?:summary|summary:)\s*(.+?)(?:\n\n|\n#|$)/i);
  if (summaryMatch) {
    return summaryMatch[1].trim().substring(0, 200);
  }

  // Fall back to first paragraph
  const firstParagraph = text.split('\n\n')[0];
  if (firstParagraph && firstParagraph.length < 200) {
    return firstParagraph.trim();
  }

  // Fall back to first sentence
  const firstSentence = text.match(/^[^.!?]+[.!?]/);
  if (firstSentence) {
    return firstSentence[0].trim();
  }

  return null;
}

// Handle process signals
process.on('SIGTERM', () => {
  sendError('Subagent terminated by parent process');
});

process.on('SIGINT', () => {
  sendError('Subagent interrupted');
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  sendError(error.message, error.stack);
});

process.on('unhandledRejection', (reason) => {
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  sendError(message, stack);
});

// Signal ready to parent process
sendMessage(SubagentMessageType.READY, { pid: process.pid });

// Run the subagent
runSubagent().catch((error) => {
  sendError(
    error instanceof Error ? error.message : String(error),
    error instanceof Error ? error.stack : undefined,
  );
});