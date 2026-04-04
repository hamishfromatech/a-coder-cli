/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  logToolCall,
  ToolCallRequestInfo,
  ToolCallResponseInfo,
  ToolRegistry,
  ToolResult,
  sessionId,
} from '../index.js';
import { Config } from '../config/config.js';
import { convertToFunctionResponse } from './coreToolScheduler.js';
import { getHookExecutor } from '../hooks/hookExecutor.js';

/**
 * Represents a tool call that was denied by a PreToolUse hook.
 */
export interface ToolDeniedError {
  type: 'tool_denied';
  toolName: string;
  reason: string;
  message: string;
}

/**
 * Executes a single tool call non-interactively.
 * It does not handle confirmations, multiple calls, or live updates.
 * Runs PreToolUse hooks before execution — hooks can deny, modify, or allow execution.
 */
export async function executeToolCall(
  config: Config,
  toolCallRequest: ToolCallRequestInfo,
  toolRegistry: ToolRegistry,
  abortSignal?: AbortSignal,
): Promise<ToolCallResponseInfo> {
  const tool = toolRegistry.getTool(toolCallRequest.name);

  const startTime = Date.now();
  if (!tool) {
    const error = new Error(
      `Tool "${toolCallRequest.name}" not found in registry.`,
    );
    const durationMs = Date.now() - startTime;
    logToolCall(config, {
      'event.name': 'tool_call',
      'event.timestamp': new Date().toISOString(),
      function_name: toolCallRequest.name,
      function_args: toolCallRequest.args,
      duration_ms: durationMs,
      success: false,
      error: error.message,
      prompt_id: toolCallRequest.prompt_id,
    });
    return {
      callId: toolCallRequest.callId,
      responseParts: [
        {
          functionResponse: {
            id: toolCallRequest.callId,
            name: toolCallRequest.name,
            response: { error: error.message },
          },
        },
      ],
      resultDisplay: error.message,
      error,
    };
  }

  // Execute PreToolUse hooks before running the tool
  const targetDir = config.getTargetDir() || process.cwd();
  const hookExecutor = getHookExecutor(sessionId, targetDir);
  const hookResults = await hookExecutor.executePreToolUseHooks(
    toolCallRequest.name,
    toolCallRequest.args as Record<string, unknown>,
  );

  // Process hook results — if any hook denies, block the tool
  let updatedArgs = { ...toolCallRequest.args } as Record<string, unknown>;
  for (const result of hookResults) {
    if (result.permissionDecision === 'deny') {
      const reason = result.error || `Tool ${toolCallRequest.name} denied by PreToolUse hook`;
      const error = new Error(reason) as Error & { type?: string };
      (error as any).type = 'tool_denied';
      const durationMs = Date.now() - startTime;
      logToolCall(config, {
        'event.name': 'tool_call',
        'event.timestamp': new Date().toISOString(),
        function_name: toolCallRequest.name,
        function_args: toolCallRequest.args,
        duration_ms: durationMs,
        success: false,
        error: reason,
        prompt_id: toolCallRequest.prompt_id,
      });
      return {
        callId: toolCallRequest.callId,
        responseParts: [
          {
            functionResponse: {
              id: toolCallRequest.callId,
              name: toolCallRequest.name,
              response: { error: reason },
            },
          },
        ],
        resultDisplay: reason,
        error,
      };
    }

    // Apply argument modifications from hooks
    if (result.updatedInput) {
      updatedArgs = { ...updatedArgs, ...result.updatedInput };
    }
  }

  // If no deny was found but a hook asked for confirmation, deny in non-interactive mode
  for (const result of hookResults) {
    if (result.permissionDecision === 'ask') {
      const reason = result.systemMessage || `Tool ${toolCallRequest.name} requires user confirmation, which is not available in non-interactive mode`;
      const error = new Error(reason) as Error & { type?: string };
      (error as any).type = 'tool_denied';
      const durationMs = Date.now() - startTime;
      logToolCall(config, {
        'event.name': 'tool_call',
        'event.timestamp': new Date().toISOString(),
        function_name: toolCallRequest.name,
        function_args: updatedArgs,
        duration_ms: durationMs,
        success: false,
        error: reason,
        prompt_id: toolCallRequest.prompt_id,
      });
      return {
        callId: toolCallRequest.callId,
        responseParts: [
          {
            functionResponse: {
              id: toolCallRequest.callId,
              name: toolCallRequest.name,
              response: { error: reason },
            },
          },
        ],
        resultDisplay: reason,
        error,
      };
    }
  }

  try {
    // Directly execute with potentially modified args
    const effectiveAbortSignal = abortSignal ?? new AbortController().signal;
    const toolResult: ToolResult = await tool.execute(
      updatedArgs,
      effectiveAbortSignal,
    );

    const tool_output = toolResult.llmContent;
    const tool_display = toolResult.returnDisplay;

    const durationMs = Date.now() - startTime;
    logToolCall(config, {
      'event.name': 'tool_call',
      'event.timestamp': new Date().toISOString(),
      function_name: toolCallRequest.name,
      function_args: updatedArgs,
      duration_ms: durationMs,
      success: true,
      prompt_id: toolCallRequest.prompt_id,
    });

    const response = convertToFunctionResponse(
      toolCallRequest.name,
      toolCallRequest.callId,
      tool_output,
    );

    return {
      callId: toolCallRequest.callId,
      responseParts: response,
      resultDisplay: tool_display,
      error: undefined,
    };
  } catch (e) {
    const error = e instanceof Error ? e : new Error(String(e));
    const durationMs = Date.now() - startTime;
    logToolCall(config, {
      'event.name': 'tool_call',
      'event.timestamp': new Date().toISOString(),
      function_name: toolCallRequest.name,
      function_args: updatedArgs,
      duration_ms: durationMs,
      success: false,
      error: error.message,
      prompt_id: toolCallRequest.prompt_id,
    });
    return {
      callId: toolCallRequest.callId,
      responseParts: [
        {
          functionResponse: {
            id: toolCallRequest.callId,
            name: toolCallRequest.name,
            response: { error: error.message },
          },
        },
      ],
      resultDisplay: error.message,
      error,
    };
  }
}
