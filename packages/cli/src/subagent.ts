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
  SUBAGENT_DEPTH_ENV_VAR,
  SubagentMessageType,
  SubagentConfig,
  SubagentResult,
  Config,
  sessionId,
  AuthType,
  ToolCallRequestInfo,
  ToolRegistry,
  GeminiEventType,
  convertToFunctionResponse,
} from '@a-coder/core';
import { Part, PartListUnion } from '@google/genai';
import { loadSettings } from './config/settings.js';
import { loadExtensions } from './config/extension.js';
import { parseArguments, loadCliConfig } from './config/config.js';
import { validateAuthMethod } from './config/auth.js';
import * as fs from 'fs/promises';
import * as path from 'path';

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
 * Execute a tool call
 */
async function executeTool(
  toolRegistry: ToolRegistry,
  toolCall: ToolCallRequestInfo,
  signal: AbortSignal,
): Promise<{ response: PartListUnion; error?: Error }> {
  const tool = toolRegistry.getTool(toolCall.name);

  if (!tool) {
    const error = new Error(`Tool "${toolCall.name}" not found in registry.`);
    return {
      response: [
        {
          functionResponse: {
            id: toolCall.callId,
            name: toolCall.name,
            response: { error: error.message },
          },
        },
      ],
      error,
    };
  }

  try {
    const result = await tool.execute(toolCall.args, signal);
    const response = convertToFunctionResponse(
      toolCall.name,
      toolCall.callId,
      result.llmContent,
    );
    return { response };
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    return {
      response: [
        {
          functionResponse: {
            id: toolCall.callId,
            name: toolCall.name,
            response: { error: error.message },
          },
        },
      ],
      error,
    };
  }
}

/**
 * Main subagent execution
 */
async function runSubagent(): Promise<void> {
  const startTime = Date.now();
  let config: Config | null = null;
  const errors: string[] = [];
  const contextFilesRead: string[] = [];

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

    // Initialize authentication
    let selectedAuthType = settings.merged.selectedAuthType;
    if (!selectedAuthType) {
      // Auto-detect auth type: prefer OpenAI if configured, otherwise use Gemini
      if (process.env.OPENAI_API_KEY || process.env.OPENAI_BASE_URL) {
        selectedAuthType = AuthType.USE_OPENAI;
      } else {
        selectedAuthType = AuthType.USE_GEMINI;
      }
    }

    const authError = validateAuthMethod(selectedAuthType);
    if (authError) {
      sendError(`Authentication error: ${authError}`);
      return;
    }

    await config.refreshAuth(selectedAuthType);

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
          contextFilesRead.push(filePath);
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

    // Load subagent-specific persistent memory if configured
    if (subagentConfig.memoryFile) {
      try {
        const memoryPath = path.isAbsolute(subagentConfig.memoryFile)
          ? subagentConfig.memoryFile
          : path.join(workspaceRoot, subagentConfig.memoryFile);
        const memoryContent = await fs.readFile(memoryPath, 'utf-8');
        if (memoryContent.trim()) {
          taskPrompt = `## Your Persistent Memory\n${memoryContent}\n\n---\n\n${taskPrompt}`;
        }
      } catch {
        // Memory file doesn't exist yet — that's fine, it'll be created on first save
      }
    }

    sendProgress('Executing task...', 30);

    // Get the Gemini client
    const client = config.getGeminiClient();
    if (!client) {
      sendError('Failed to initialize AI client');
      return;
    }

    // Create an isolated tool registry for this subagent.
    // This gives the subagent its own tools and MCP servers,
    // separate from the parent agent's global registry.
    const toolRegistry = await config.createSubagentToolRegistry({
      allowedTools: subagentConfig.allowedTools,
      disallowedTools: subagentConfig.disallowedTools,
      blockNestedSubagents: subagentConfig.blockNestedSubagents,
      mcpServers: subagentConfig.mcpServers,
    });

    // Execute the agentic loop
    let accumulatedResponse = ''; // Accumulate all response text across turns
    const abortController = new AbortController();
    const MAX_TURNS = 50;
    let turnCount = 0;

    // Set up timeout
    const timeout = subagentConfig.timeout || 300000;
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, timeout);

    // Track pending tool calls
    let pendingToolCalls: ToolCallRequestInfo[] = [];

    // Use Sets to deduplicate tracking
    const filesReadSet = new Set<string>();
    const filesModifiedSet = new Set<string>();
    const commandsExecutedSet = new Set<string>();

    try {
      // Start the conversation with the initial prompt
      let currentMessage: PartListUnion = [{ text: taskPrompt }];

      while (!abortController.signal.aborted && turnCount < MAX_TURNS) {
        turnCount++;

        const stream = client.sendMessageStream(
          currentMessage,
          abortController.signal,
          sessionId,
        );

        pendingToolCalls = [];
        let turnResponse = '';

        for await (const event of stream) {
          if (abortController.signal.aborted) {
            break;
          }

          if (event.type === GeminiEventType.Content) {
            turnResponse += event.value;
          } else if (event.type === GeminiEventType.ToolCallRequest) {
            // Collect tool call requests
            pendingToolCalls.push(event.value as ToolCallRequestInfo);
          } else if (event.type === GeminiEventType.Error) {
            errors.push(event.value.error.message);
          }
        }

        // Accumulate response from this turn
        if (turnResponse) {
          if (accumulatedResponse) {
            accumulatedResponse += '\n\n';
          }
          accumulatedResponse += turnResponse;
        }

        // If no tool calls, we're done
        if (pendingToolCalls.length === 0) {
          break;
        }

        // Execute all pending tool calls
        sendProgress(`Executing ${pendingToolCalls.length} tool(s)...`, undefined);

        const toolResponses: PartListUnion = [];

        for (const toolCall of pendingToolCalls) {
          const toolName = toolCall.name;
          const toolArgs = toolCall.args as Record<string, unknown>;

          // Track file operations for reporting (using Set to deduplicate)
          if (toolName === 'read_file' && toolArgs?.absolute_path) {
            filesReadSet.add(toolArgs.absolute_path as string);
          } else if (toolName === 'write_file' && toolArgs?.file_path) {
            filesModifiedSet.add(toolArgs.file_path as string);
          } else if (toolName === 'edit' && toolArgs?.file_path) {
            filesModifiedSet.add(toolArgs.file_path as string);
          } else if (toolName === 'shell' && toolArgs?.command) {
            commandsExecutedSet.add(toolArgs.command as string);
          }

          // Execute the tool
          const result = await executeTool(toolRegistry, toolCall, abortController.signal);

          if (result.error) {
            errors.push(`Tool ${toolName} error: ${result.error.message}`);
          }

          // Convert PartListUnion to array for spreading
          const responseParts = Array.isArray(result.response)
            ? result.response
            : [{ text: String(result.response) }];
          toolResponses.push(...responseParts);
        }

        // Send tool responses as the next message
        currentMessage = toolResponses;
      }

    } finally {
      clearTimeout(timeoutId);
    }

    sendProgress('Finalizing...', 90);

    // Merge context files with files read during execution
    for (const f of contextFilesRead) {
      filesReadSet.add(f);
    }

    // Build the result
    const duration = Date.now() - startTime;
    const result: SubagentResult = {
      success: errors.length === 0,
      summary: extractSummary(accumulatedResponse) || 'Task completed',
      details: accumulatedResponse,
      filesRead: filesReadSet.size > 0 ? Array.from(filesReadSet) : undefined,
      filesModified: filesModifiedSet.size > 0 ? Array.from(filesModifiedSet) : undefined,
      commandsExecuted: commandsExecutedSet.size > 0 ? Array.from(commandsExecutedSet) : undefined,
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
      filesRead: contextFilesRead.length > 0 ? contextFilesRead : undefined,
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