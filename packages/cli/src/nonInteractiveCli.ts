/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Config,
  ToolCallRequestInfo,
  executeToolCall,
  ToolRegistry,
  shutdownTelemetry,
  isTelemetrySdkInitialized,
  ToolResultDisplay,
  validateShellCommand,
} from '@a-coder/core';
import {
  Content,
  Part,
  FunctionCall,
  GenerateContentResponse,
} from '@google/genai';

import { parseAndFormatApiError } from './ui/utils/errorParsing.js';

/**
 * Structured output format for --print mode
 */
interface PrintOutput {
  type: 'text' | 'tool_call' | 'tool_result' | 'error';
  timestamp: string;
  data: {
    text?: string;
    tool_name?: string;
    tool_args?: Record<string, unknown>;
    result?: unknown;
    error?: string;
  };
}

function getResponseText(response: GenerateContentResponse): string | null {
  if (response.candidates && response.candidates.length > 0) {
    const candidate = response.candidates[0];
    if (
      candidate.content &&
      candidate.content.parts &&
      candidate.content.parts.length > 0
    ) {
      // We are running in headless mode so we don't need to return thoughts to STDOUT.
      const thoughtPart = candidate.content.parts[0];
      if (thoughtPart?.thought) {
        return null;
      }
      return candidate.content.parts
        .filter((part) => part.text)
        .map((part) => part.text)
        .join('');
    }
  }
  return null;
}

// Helper function to format tool call arguments for display
function formatToolArgs(args: Record<string, unknown>): string {
  if (!args || Object.keys(args).length === 0) {
    return '(no arguments)';
  }

  const formattedArgs = Object.entries(args)
    .map(([key, value]) => {
      if (typeof value === 'string') {
        return `${key}: "${value}"`;
      } else if (typeof value === 'object' && value !== null) {
        return `${key}: ${JSON.stringify(value)}`;
      } else {
        return `${key}: ${value}`;
      }
    })
    .join(', ');

  return `(${formattedArgs})`;
}

/**
 * Output in structured JSON format for --print mode
 */
function printStructuredOutput(output: PrintOutput): void {
  console.log(JSON.stringify(output));
}

/**
 * Create a print output object
 */
function createPrintOutput(
  type: PrintOutput['type'],
  data: PrintOutput['data'],
): PrintOutput {
  return {
    type,
    timestamp: new Date().toISOString(),
    data,
  };
}

// Helper function to display tool call information
function displayToolCallInfo(
  toolName: string,
  args: Record<string, unknown>,
  status: 'start' | 'success' | 'error',
  resultDisplay?: ToolResultDisplay,
  errorMessage?: string,
  printMode?: boolean,
): void {
  // In print mode, output structured JSON
  if (printMode) {
    if (status === 'start') {
      printStructuredOutput(
        createPrintOutput('tool_call', {
          tool_name: toolName,
          tool_args: args,
        }),
      );
    } else if (status === 'success') {
      printStructuredOutput(
        createPrintOutput('tool_result', {
          tool_name: toolName,
          result: typeof resultDisplay === 'string'
            ? resultDisplay
            : resultDisplay,
        }),
      );
    } else if (status === 'error') {
      printStructuredOutput(
        createPrintOutput('error', {
          tool_name: toolName,
          error: errorMessage,
        }),
      );
    }
    return;
  }

  // Human-readable output
  const timestamp = new Date().toLocaleTimeString();
  const argsStr = formatToolArgs(args);

  switch (status) {
    case 'start':
      process.stdout.write(
        `\n[${timestamp}] 🔧 Executing tool: ${toolName} ${argsStr}\n`,
      );
      break;
    case 'success':
      if (resultDisplay) {
        if (typeof resultDisplay === 'string' && resultDisplay.trim()) {
          process.stdout.write(
            `[${timestamp}] ✅ Tool ${toolName} completed successfully\n`,
          );
          process.stdout.write(`📋 Result:\n${resultDisplay}\n`);
        } else if (
          typeof resultDisplay === 'object' &&
          'fileDiff' in resultDisplay
        ) {
          process.stdout.write(
            `[${timestamp}] ✅ Tool ${toolName} completed successfully\n`,
          );
          process.stdout.write(`📋 File: ${resultDisplay.fileName}\n`);
          process.stdout.write(`📋 Diff:\n${resultDisplay.fileDiff}\n`);
        } else {
          process.stdout.write(
            `[${timestamp}] ✅ Tool ${toolName} completed successfully (no output)\n`,
          );
        }
      } else {
        process.stdout.write(
          `[${timestamp}] ✅ Tool ${toolName} completed successfully (no output)\n`,
        );
      }
      break;
    case 'error':
      process.stdout.write(
        `[${timestamp}] ❌ Tool ${toolName} failed: ${errorMessage}\n`,
      );
      break;
    default:
      process.stdout.write(
        `[${timestamp}] ⚠️ Tool ${toolName} reported unknown status: ${status}\n`,
      );
      break;
  }
}

export async function runNonInteractive(
  config: Config,
  input: string,
  prompt_id: string,
  printMode: boolean = false,
): Promise<void> {
  await config.initialize();
  // Handle EPIPE errors when the output is piped to a command that closes early.
  process.stdout.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EPIPE') {
      // Exit gracefully if the pipe is closed.
      process.exit(0);
    }
  });

  const geminiClient = config.getGeminiClient();
  const toolRegistry: ToolRegistry = await config.getToolRegistry();

  const chat = await geminiClient.getChat();
  const abortController = new AbortController();
  let currentMessages: Content[] = [{ role: 'user', parts: [{ text: input }] }];
  let turnCount = 0;
  try {
    while (true) {
      turnCount++;
      if (
        config.getMaxSessionTurns() > 0 &&
        turnCount > config.getMaxSessionTurns()
      ) {
        if (printMode) {
          printStructuredOutput(
            createPrintOutput('error', {
              error: 'Max session turns reached',
            }),
          );
        } else {
          console.error(
            '\n Reached max session turns for this session. Increase the number of turns by specifying maxSessionTurns in settings.json.',
          );
        }
        return;
      }
      const functionCalls: FunctionCall[] = [];

      const responseStream = await chat.sendMessageStream(
        {
          message: currentMessages[0]?.parts || [], // Ensure parts are always provided
          config: {
            abortSignal: abortController.signal,
            tools: [
              { functionDeclarations: toolRegistry.getFunctionDeclarations() },
            ],
          },
        },
        prompt_id,
      );

      for await (const resp of responseStream) {
        if (config.getDebugMode()) {
          console.log('[DEBUG] Non-interactive received stream response chunk');
        }
        if (abortController.signal.aborted) {
          if (printMode) {
            printStructuredOutput(
              createPrintOutput('error', {
                error: 'Operation cancelled',
              }),
            );
          } else {
            console.error('Operation cancelled.');
          }
          return;
        }
        const textPart = getResponseText(resp);
        if (textPart) {
          if (printMode) {
            printStructuredOutput(
              createPrintOutput('text', {
                text: textPart,
              }),
            );
          } else {
            process.stdout.write(textPart);
          }
        }
        if (resp.functionCalls) {
          if (config.getDebugMode()) {
            console.log(`[DEBUG] Found ${resp.functionCalls.length} function calls`);
          }
          functionCalls.push(...resp.functionCalls);
        }
      }

      if (config.getDebugMode()) {
        console.log(`[DEBUG] Stream finished. Total function calls: ${functionCalls.length}`);
      }

      if (functionCalls.length > 0) {
        const toolResponseParts: Part[] = [];

        for (const fc of functionCalls) {
          const callId = fc.id ?? `${fc.name}-${Date.now()}`;
          const requestInfo: ToolCallRequestInfo = {
            callId,
            name: fc.name as string,
            args: (fc.args ?? {}) as Record<string, unknown>,
            isClientInitiated: false,
            prompt_id,
          };

          // Validate Shell commands in non-interactive mode (unless YOLO)
          if (fc.name === 'Shell' && config.getApprovalMode() !== 'yolo' as any) {
            const command = (fc.args as any)?.command || '';
            const validation = validateShellCommand(command);
            if (!validation.allowed) {
              const errorMsg = `Shell command blocked in non-interactive mode: ${validation.reason}`;
              if (printMode) {
                printStructuredOutput(
                  createPrintOutput('error', {
                    tool_name: 'Shell',
                    error: errorMsg,
                  }),
                );
              } else {
                console.error(`[blocked] Shell: ${command}`);
                console.error(`  Reason: ${validation.reason}`);
              }
              // Skip this tool call and continue with others
              toolResponseParts.push({
                text: `Error: ${errorMsg}`,
              });
              continue;
            }
          }

          //Display tool call start information
          displayToolCallInfo(fc.name as string, fc.args ?? {}, 'start', undefined, undefined, printMode);

          const toolResponse = await executeToolCall(
            config,
            requestInfo,
            toolRegistry,
            abortController.signal,
          );

          if (toolResponse.error) {
            // Display tool call error information
            const errorMessage =
              typeof toolResponse.resultDisplay === 'string'
                ? toolResponse.resultDisplay
                : toolResponse.error?.message;

            displayToolCallInfo(
              fc.name as string,
              fc.args ?? {},
              'error',
              undefined,
              errorMessage,
              printMode,
            );

            const isToolNotFound = toolResponse.error.message.includes(
              'not found in registry',
            );
            if (printMode) {
              printStructuredOutput(
                createPrintOutput('error', {
                  tool_name: fc.name as string,
                  error: `Error executing tool ${fc.name}: ${toolResponse.resultDisplay || toolResponse.error.message}`,
                }),
              );
            } else {
              console.error(
                `Error executing tool ${fc.name}: ${toolResponse.resultDisplay || toolResponse.error.message}`,
              );
            }
            if (!isToolNotFound) {
              process.exit(1);
            }
          } else {
            // Display tool call success information
            displayToolCallInfo(
              fc.name as string,
              fc.args ?? {},
              'success',
              toolResponse.resultDisplay,
              undefined,
              printMode,
            );
          }

          if (toolResponse.responseParts) {
            const parts = Array.isArray(toolResponse.responseParts)
              ? toolResponse.responseParts
              : [toolResponse.responseParts];
            for (const part of parts) {
              if (typeof part === 'string') {
                toolResponseParts.push({ text: part });
              } else if (part) {
                toolResponseParts.push(part);
              }
            }
          }
        }
        currentMessages = [{ role: 'user', parts: toolResponseParts }];
      } else {
        if (!printMode) {
          process.stdout.write('\n'); // Ensure a final newline
        }
        return;
      }
    }
  } catch (error) {
    if (printMode) {
      printStructuredOutput(
        createPrintOutput('error', {
          error: parseAndFormatApiError(
            error,
            config.getContentGeneratorConfig()?.authType,
          ),
        }),
      );
    } else {
      console.error(
        parseAndFormatApiError(
          error,
          config.getContentGeneratorConfig()?.authType,
        ),
      );
    }
    process.exit(1);
  } finally {
    if (isTelemetrySdkInitialized()) {
      await shutdownTelemetry();
    }
  }
}
