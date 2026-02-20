/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Schema, Type } from '@google/genai';
import { BaseTool, ToolResult, ToolCallConfirmationDetails } from './tools.js';
import {
  SubagentConfig,
  SubagentResult,
  DEFAULT_SUBAGENT_CONFIG,
} from './subagent-types.js';
import { getSubagentManager } from '../services/subagentManager.js';
import { randomUUID } from 'crypto';

/**
 * Parameters for the SubagentTool
 */
export interface SubagentToolParams {
  /** The task description for the subagent to accomplish */
  task: string;

  /** Working directory for the subagent (defaults to project root) */
  workingDir?: string;

  /** Relevant context to provide to the subagent */
  context?: string;

  /** Specific files to include in context */
  contextFiles?: string[];

  /** Subset of tool names to allow */
  allowedTools?: string[];

  /** Maximum execution time in milliseconds */
  timeout?: number;

  /** Model to use for the subagent */
  model?: string;

  /** Whether to allow destructive tools (edit, write_file, shell) */
  allowDestructive?: boolean;
}

/**
 * Tool for spawning subagents to handle specialized tasks
 */
export class SubagentTool extends BaseTool<SubagentToolParams, ToolResult> {
  private sessionId: string;

  constructor(sessionId: string) {
    super(
      'subagent',
      'Subagent',
      `Spawn a specialized sub-agent to handle a specific task independently.

This tool creates a child agent process that can work on a focused task with its own context.
Useful for:
- Parallel task execution
- Isolating complex operations
- Breaking down large tasks into smaller pieces
- Tasks that need focused context to avoid token limits

The subagent will have access to a subset of tools and will return a summary of its work.
By default, subagents have read-only access. Set allowDestructive=true for write operations.`,
      {
        type: Type.OBJECT,
        properties: {
          task: {
            type: Type.STRING,
            description:
              'Clear, specific description of what the subagent should accomplish. Be explicit about the expected output.',
          },
          workingDir: {
            type: Type.STRING,
            description:
              'Working directory for the subagent. Defaults to the current project root.',
          },
          context: {
            type: Type.STRING,
            description:
              'Additional context to provide to the subagent. Include relevant background information, constraints, or requirements.',
          },
          contextFiles: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description:
              'List of file paths to include in the subagent context. Use glob patterns or specific paths.',
          },
          allowedTools: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description:
              'List of tool names the subagent can use. Defaults to read-only tools: read_file, glob, grep, list_directory, web_fetch, web_search.',
          },
          timeout: {
            type: Type.NUMBER,
            description:
              'Maximum execution time in milliseconds. Default: 300000 (5 minutes). Maximum: 600000 (10 minutes).',
          },
          model: {
            type: Type.STRING,
            description:
              'Specific model to use for the subagent. Defaults to the same model as the main agent.',
          },
          allowDestructive: {
            type: Type.BOOLEAN,
            description:
              'Allow the subagent to use destructive tools (edit, write_file, shell). Default: false. Use with caution.',
          },
        },
        required: ['task'],
      },
      true, // isOutputMarkdown
      false, // canUpdateOutput
    );

    this.sessionId = sessionId;
  }

  /**
   * Validate the parameters
   */
  override validateToolParams(params: SubagentToolParams): string | null {
    if (!params.task || params.task.trim().length === 0) {
      return 'Task description is required';
    }

    if (params.timeout) {
      if (params.timeout < 1000) {
        return 'Timeout must be at least 1000ms (1 second)';
      }
      if (params.timeout > 600000) {
        return 'Timeout cannot exceed 600000ms (10 minutes)';
      }
    }

    if (params.allowedTools && params.allowedTools.length === 0) {
      return 'If specified, allowedTools must contain at least one tool';
    }

    return null;
  }

  /**
   * Get a description of what this tool will do
   */
  override getDescription(params: SubagentToolParams): string {
    let desc = `Spawning subagent to: ${params.task}`;

    if (params.allowDestructive) {
      desc += '\n⚠️ Destructive operations allowed';
    }

    if (params.allowedTools && params.allowedTools.length > 0) {
      desc += `\nTools: ${params.allowedTools.join(', ')}`;
    }

    if (params.timeout) {
      desc += `\nTimeout: ${Math.round(params.timeout / 1000)}s`;
    }

    return desc;
  }

  /**
   * Determine if confirmation is needed
   */
  override async shouldConfirmExecute(
    params: SubagentToolParams,
    _abortSignal: AbortSignal,
  ): Promise<ToolCallConfirmationDetails | false> {
    // Require confirmation for destructive operations
    if (params.allowDestructive) {
      return {
        type: 'exec',
        title: 'Spawn Subagent with Destructive Tools',
        command: `subagent --allow-destructive --task "${params.task.substring(0, 50)}..."`,
        rootCommand: 'subagent',
        onConfirm: async () => {
          // Confirmation handled by the UI
        },
      };
    }

    // No confirmation needed for read-only operations
    return false;
  }

  /**
   * Execute the subagent
   */
  override async execute(
    params: SubagentToolParams,
    signal: AbortSignal,
    _updateOutput?: (output: string) => void,
  ): Promise<ToolResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return {
        summary: 'Invalid parameters',
        llmContent: `Error: ${validationError}`,
        returnDisplay: `Error: ${validationError}`,
      };
    }

    // Build the subagent config
    const config: SubagentConfig = {
      id: randomUUID(),
      task: params.task,
      workingDir: params.workingDir,
      context: params.context,
      contextFiles: params.contextFiles,
      allowedTools: params.allowedTools || DEFAULT_SUBAGENT_CONFIG.allowedTools,
      timeout: Math.min(params.timeout || DEFAULT_SUBAGENT_CONFIG.defaultTimeout, 600000),
      model: params.model,
      allowDestructive: params.allowDestructive || false,
      parentSessionId: this.sessionId,
      abortSignal: signal,
    };

    // If destructive tools are allowed, add them to allowedTools
    if (params.allowDestructive && config.allowedTools) {
      config.allowedTools = [
        ...config.allowedTools,
        'edit',
        'write_file',
        'shell',
      ];
    }

    try {
      const manager = getSubagentManager();
      const result = await manager.spawnSubagent(config);

      return this.formatResult(result);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      return {
        summary: 'Failed to spawn subagent',
        llmContent: `Error spawning subagent: ${errorMessage}`,
        returnDisplay: `Error: ${errorMessage}`,
      };
    }
  }

  /**
   * Format the subagent result for display
   */
  private formatResult(result: SubagentResult): ToolResult {
    let llmContent = `## Subagent Result\n\n`;
    llmContent += `**Status:** ${result.success ? '✅ Success' : '❌ Failed'}\n`;
    llmContent += `**Summary:** ${result.summary}\n\n`;

    if (result.details) {
      llmContent += `### Details\n${result.details}\n\n`;
    }

    if (result.filesModified && result.filesModified.length > 0) {
      llmContent += `### Files Modified\n${result.filesModified.map((f) => `- ${f}`).join('\n')}\n\n`;
    }

    if (result.filesRead && result.filesRead.length > 0) {
      llmContent += `### Files Read\n${result.filesRead.map((f) => `- ${f}`).join('\n')}\n\n`;
    }

    if (result.commandsExecuted && result.commandsExecuted.length > 0) {
      llmContent += `### Commands Executed\n${result.commandsExecuted.map((c) => `- \`${c}\``).join('\n')}\n\n`;
    }

    if (result.errors && result.errors.length > 0) {
      llmContent += `### Errors\n${result.errors.map((e) => `- ${e}`).join('\n')}\n\n`;
    }

    if (result.duration) {
      llmContent += `**Duration:** ${Math.round(result.duration / 1000)}s\n`;
    }

    let returnDisplay = result.summary;
    if (result.filesModified && result.filesModified.length > 0) {
      returnDisplay += `\n\nModified: ${result.filesModified.join(', ')}`;
    }
    if (result.errors && result.errors.length > 0) {
      returnDisplay += `\n\nErrors: ${result.errors.join('; ')}`;
    }

    return {
      summary: result.summary,
      llmContent,
      returnDisplay,
    };
  }
}

// Export the tool name for registration
export const SubagentToolName = 'subagent';
