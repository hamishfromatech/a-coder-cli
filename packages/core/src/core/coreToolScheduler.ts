/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  ToolCallRequestInfo,
  ToolCallResponseInfo,
  ToolConfirmationOutcome,
  Tool,
  ToolCallConfirmationDetails,
  ToolResult,
  ToolRegistry,
  ApprovalMode,
  EditorType,
  Config,
  logToolCall,
  ToolCallEvent,
  ToolConfirmationPayload,
} from '../index.js';
import { Part, PartListUnion } from '@google/genai';
import { getResponseTextFromParts } from '../utils/generateContentResponseUtilities.js';
import {
  isModifiableTool,
  ModifyContext,
  modifyWithEditor,
} from '../tools/modifiable-tool.js';
import {
  getHookExecutor,
  HookExecutor,
} from '../hooks/hookExecutor.js';
import * as Diff from 'diff';
import {
  getPermissionStore,
  scopeFromOutcome,
} from '../utils/permissionStore.js';

export type ValidatingToolCall = {
  status: 'validating';
  request: ToolCallRequestInfo;
  tool: Tool;
  startTime?: number;
  outcome?: ToolConfirmationOutcome;
};

export type ScheduledToolCall = {
  status: 'scheduled';
  request: ToolCallRequestInfo;
  tool: Tool;
  startTime?: number;
  outcome?: ToolConfirmationOutcome;
};

export type ErroredToolCall = {
  status: 'error';
  request: ToolCallRequestInfo;
  tool?: Tool;
  response: ToolCallResponseInfo;
  durationMs?: number;
  outcome?: ToolConfirmationOutcome;
};

export type SuccessfulToolCall = {
  status: 'success';
  request: ToolCallRequestInfo;
  tool: Tool;
  response: ToolCallResponseInfo;
  durationMs?: number;
  outcome?: ToolConfirmationOutcome;
};

export type ExecutingToolCall = {
  status: 'executing';
  request: ToolCallRequestInfo;
  tool: Tool;
  liveOutput?: string;
  startTime?: number;
  outcome?: ToolConfirmationOutcome;
};

export type CancelledToolCall = {
  status: 'cancelled';
  request: ToolCallRequestInfo;
  response: ToolCallResponseInfo;
  tool: Tool;
  durationMs?: number;
  outcome?: ToolConfirmationOutcome;
};

export type WaitingToolCall = {
  status: 'awaiting_approval';
  request: ToolCallRequestInfo;
  tool: Tool;
  confirmationDetails: ToolCallConfirmationDetails;
  startTime?: number;
  outcome?: ToolConfirmationOutcome;
};

export type Status = ToolCall['status'];

export type ToolCall =
  | ValidatingToolCall
  | ScheduledToolCall
  | ErroredToolCall
  | SuccessfulToolCall
  | ExecutingToolCall
  | CancelledToolCall
  | WaitingToolCall;

export type CompletedToolCall =
  | SuccessfulToolCall
  | CancelledToolCall
  | ErroredToolCall;

export type ConfirmHandler = (
  toolCall: WaitingToolCall,
) => Promise<ToolConfirmationOutcome>;

export type OutputUpdateHandler = (
  toolCallId: string,
  outputChunk: string,
) => void;

export type AllToolCallsCompleteHandler = (
  completedToolCalls: CompletedToolCall[],
) => void;

export type ToolCallsUpdateHandler = (toolCalls: ToolCall[]) => void;

/**
 * Formats tool output for a Gemini FunctionResponse.
 */
function createFunctionResponsePart(
  callId: string,
  toolName: string,
  output: string,
  thought_signature?: string,
): Part {
  return {
    functionResponse: {
      id: callId,
      name: toolName,
      response: { output },
      // Attach thought_signature to the function response
      thought_signature,
    } as any,
  };
}

export function convertToFunctionResponse(
  toolName: string,
  callId: string,
  llmContent: PartListUnion,
  thought_signature?: string,
): PartListUnion {
  const contentToProcess =
    Array.isArray(llmContent) && llmContent.length === 1
      ? llmContent[0]
      : llmContent;

  if (typeof contentToProcess === 'string') {
    return createFunctionResponsePart(callId, toolName, contentToProcess, thought_signature);
  }

  if (Array.isArray(contentToProcess)) {
    const functionResponse = createFunctionResponsePart(
      callId,
      toolName,
      'Tool execution succeeded.',
      thought_signature,
    );
    return [functionResponse, ...contentToProcess];
  }

  // After this point, contentToProcess is a single Part object.
  if (contentToProcess.functionResponse) {
    if (contentToProcess.functionResponse.response?.content) {
      const stringifiedOutput =
        getResponseTextFromParts(
          contentToProcess.functionResponse.response.content as Part[],
        ) || '';
      return createFunctionResponsePart(callId, toolName, stringifiedOutput, thought_signature);
    }
    // It's a functionResponse that we should pass through as is.
    if (thought_signature) {
      (contentToProcess.functionResponse as any).thought_signature = thought_signature;
    }
    return contentToProcess;
  }

  if (contentToProcess.inlineData || contentToProcess.fileData) {
    const mimeType =
      contentToProcess.inlineData?.mimeType ||
      contentToProcess.fileData?.mimeType ||
      'unknown';
    const functionResponse = createFunctionResponsePart(
      callId,
      toolName,
      `Binary content of type ${mimeType} was processed.`,
      thought_signature,
    );
    return [functionResponse, contentToProcess];
  }

  if (contentToProcess.text !== undefined) {
    return createFunctionResponsePart(callId, toolName, contentToProcess.text, thought_signature);
  }

  // Default case for other kinds of parts.
  return createFunctionResponsePart(
    callId,
    toolName,
    'Tool execution succeeded.',
    thought_signature,
  );
}

const createErrorResponse = (
  request: ToolCallRequestInfo,
  error: Error,
): ToolCallResponseInfo => ({
  callId: request.callId,
  error,
  responseParts: {
    functionResponse: {
      id: request.callId,
      name: request.name,
      response: { error: error.message },
      thought_signature: request.thought_signature,
    } as any,
  },
  resultDisplay: error.message,
});

interface CoreToolSchedulerOptions {
  toolRegistry: Promise<ToolRegistry>;
  outputUpdateHandler?: OutputUpdateHandler;
  onAllToolCallsComplete?: AllToolCallsCompleteHandler;
  onToolCallsUpdate?: ToolCallsUpdateHandler;
  approvalMode?: ApprovalMode;
  getPreferredEditor: () => EditorType | undefined;
  config: Config;
}

export class CoreToolScheduler {
  private toolRegistry: Promise<ToolRegistry>;
  private toolCalls: ToolCall[] = [];
  private outputUpdateHandler?: OutputUpdateHandler;
  private onAllToolCallsComplete?: AllToolCallsCompleteHandler;
  private onToolCallsUpdate?: ToolCallsUpdateHandler;
  private approvalMode: ApprovalMode;
  private getPreferredEditor: () => EditorType | undefined;
  private config: Config;
  private hookExecutor: HookExecutor | null = null;

  constructor(options: CoreToolSchedulerOptions) {
    this.config = options.config;
    this.toolRegistry = options.toolRegistry;
    this.outputUpdateHandler = options.outputUpdateHandler;
    this.onAllToolCallsComplete = options.onAllToolCallsComplete;
    this.onToolCallsUpdate = options.onToolCallsUpdate;
    this.approvalMode = options.approvalMode ?? ApprovalMode.DEFAULT;
    this.getPreferredEditor = options.getPreferredEditor;
  }

  /**
   * Set the hook executor for PreToolUse hooks
   */
  setHookExecutor(executor: HookExecutor): void {
    this.hookExecutor = executor;
  }

  private setStatusInternal(
    targetCallId: string,
    status: 'success',
    response: ToolCallResponseInfo,
  ): void;
  private setStatusInternal(
    targetCallId: string,
    status: 'awaiting_approval',
    confirmationDetails: ToolCallConfirmationDetails,
  ): void;
  private setStatusInternal(
    targetCallId: string,
    status: 'error',
    response: ToolCallResponseInfo,
  ): void;
  private setStatusInternal(
    targetCallId: string,
    status: 'cancelled',
    reason: string,
  ): void;
  private setStatusInternal(
    targetCallId: string,
    status: 'executing' | 'scheduled' | 'validating',
  ): void;
  private setStatusInternal(
    targetCallId: string,
    newStatus: Status,
    auxiliaryData?: unknown,
  ): void {
    this.toolCalls = this.toolCalls.map((currentCall) => {
      if (
        currentCall.request.callId !== targetCallId ||
        currentCall.status === 'success' ||
        currentCall.status === 'error' ||
        currentCall.status === 'cancelled'
      ) {
        return currentCall;
      }

      // currentCall is a non-terminal state here and should have startTime and tool.
      const existingStartTime = currentCall.startTime;
      const toolInstance = currentCall.tool;

      const outcome = currentCall.outcome;

      switch (newStatus) {
        case 'success': {
          const durationMs = existingStartTime
            ? Date.now() - existingStartTime
            : undefined;
          return {
            request: currentCall.request,
            tool: toolInstance,
            status: 'success',
            response: auxiliaryData as ToolCallResponseInfo,
            durationMs,
            outcome,
          } as SuccessfulToolCall;
        }
        case 'error': {
          const durationMs = existingStartTime
            ? Date.now() - existingStartTime
            : undefined;
          return {
            request: currentCall.request,
            tool: toolInstance,
            status: 'error',
            response: auxiliaryData as ToolCallResponseInfo,
            durationMs,
            outcome,
          };
        }
        case 'awaiting_approval':
          return {
            request: currentCall.request,
            tool: toolInstance,
            status: 'awaiting_approval',
            confirmationDetails: auxiliaryData as ToolCallConfirmationDetails,
            startTime: existingStartTime,
            outcome,
          } as WaitingToolCall;
        case 'scheduled':
          return {
            request: currentCall.request,
            tool: toolInstance,
            status: 'scheduled',
            startTime: existingStartTime,
            outcome,
          } as ScheduledToolCall;
        case 'cancelled': {
          const durationMs = existingStartTime
            ? Date.now() - existingStartTime
            : undefined;
          return {
            request: currentCall.request,
            tool: toolInstance,
            status: 'cancelled',
            response: {
              callId: currentCall.request.callId,
              responseParts: {
                functionResponse: {
                  id: currentCall.request.callId,
                  name: currentCall.request.name,
                  response: {
                    error: `[Operation Cancelled] Reason: ${auxiliaryData}`,
                  },
                  thought_signature: currentCall.request.thought_signature,
                },
              } as any,
              resultDisplay: undefined,
              error: undefined,
            },
            durationMs,
            outcome,
          } as CancelledToolCall;
        }
        case 'validating':
          return {
            request: currentCall.request,
            tool: toolInstance,
            status: 'validating',
            startTime: existingStartTime,
            outcome,
          } as ValidatingToolCall;
        case 'executing':
          return {
            request: currentCall.request,
            tool: toolInstance,
            status: 'executing',
            startTime: existingStartTime,
            outcome,
          } as ExecutingToolCall;
        default: {
          const exhaustiveCheck: never = newStatus;
          return exhaustiveCheck;
        }
      }
    });
    this.notifyToolCallsUpdate();
    this.checkAndNotifyCompletion();
  }

  private setArgsInternal(targetCallId: string, args: unknown): void {
    this.toolCalls = this.toolCalls.map((call) => {
      if (call.request.callId !== targetCallId) return call;
      return {
        ...call,
        request: { ...call.request, args: args as Record<string, unknown> },
      };
    });
  }

  private isRunning(): boolean {
    return this.toolCalls.some(
      (call) =>
        call.status === 'executing' || call.status === 'awaiting_approval',
    );
  }

  async schedule(
    request: ToolCallRequestInfo | ToolCallRequestInfo[],
    signal: AbortSignal,
  ): Promise<void> {
    if (this.isRunning()) {
      throw new Error(
        'Cannot schedule new tool calls while other tool calls are actively running (executing or awaiting approval).',
      );
    }
    const requestsToProcess = Array.isArray(request) ? request : [request];
    const toolRegistry = await this.toolRegistry;

    const newToolCalls: ToolCall[] = requestsToProcess.map(
      (reqInfo): ToolCall => {
        const toolInstance = toolRegistry.getTool(reqInfo.name);
        if (!toolInstance) {
          return {
            status: 'error',
            request: reqInfo,
            response: createErrorResponse(
              reqInfo,
              new Error(`Tool "${reqInfo.name}" not found in registry.`),
            ),
            durationMs: 0,
          };
        }
        return {
          status: 'validating',
          request: reqInfo,
          tool: toolInstance,
          startTime: Date.now(),
        };
      },
    );

    this.toolCalls = this.toolCalls.concat(newToolCalls);
    this.notifyToolCallsUpdate();

    for (const toolCall of newToolCalls) {
      if (toolCall.status !== 'validating') {
        continue;
      }

      const { request: reqInfo, tool: toolInstance } = toolCall;
      try {
        // Execute PreToolUse hooks if available
        if (this.hookExecutor) {
          const hookResults = await this.hookExecutor.executePreToolUseHooks(
            reqInfo.name,
            reqInfo.args as Record<string, unknown>,
          );

          // Process hook results
          for (const result of hookResults) {
            // If any hook denies, block the tool
            if (result.permissionDecision === 'deny') {
              this.setStatusInternal(
                reqInfo.callId,
                'error',
                createErrorResponse(
                  reqInfo,
                  new Error(result.error || `Tool ${reqInfo.name} denied by PreToolUse hook`),
                ),
              );
              continue;
            }

            // If any hook asks for confirmation, defer to user
            if (result.permissionDecision === 'ask') {
              const hookOnConfirm = async (outcome: ToolConfirmationOutcome) => {
                if (outcome === ToolConfirmationOutcome.Cancel) {
                  this.setStatusInternal(
                    reqInfo.callId,
                    'cancelled',
                    'User denied the tool call',
                  );
                } else {
                  this.setStatusInternal(reqInfo.callId, 'scheduled');
                  this.attemptExecutionOfScheduledCalls(signal);
                }
              };
              const askConfirmationDetails: ToolCallConfirmationDetails = {
                type: 'ask',
                title: `Confirm: ${reqInfo.name}`,
                message: result.systemMessage || `The tool ${reqInfo.name} requires your confirmation.`,
                onConfirm: (
                  outcome: ToolConfirmationOutcome,
                  payload?: ToolConfirmationPayload,
                ) =>
                  this.handleConfirmationResponse(
                    reqInfo.callId,
                    hookOnConfirm,
                    outcome,
                    signal,
                    payload,
                  ),
              };
              this.setStatusInternal(reqInfo.callId, 'awaiting_approval', askConfirmationDetails);
              continue;
            }

            // Apply updated input from hooks
            if (result.updatedInput) {
              reqInfo.args = { ...reqInfo.args, ...result.updatedInput } as Record<string, unknown>;
            }
          }
        }

        // Check if tool was already handled by hooks (denied or awaiting_approval)
        const currentStatus = this.toolCalls.find(c => c.request.callId === reqInfo.callId)?.status;
        if (currentStatus === 'error' || currentStatus === 'awaiting_approval') {
          continue;
        }

        if (this.approvalMode === ApprovalMode.YOLO) {
          this.setStatusInternal(reqInfo.callId, 'scheduled');
        } else {
          // Check persisted permission rules before prompting the user
          const permissionStore = getPermissionStore();
          const hasPersistedPermission = await permissionStore.checkPermission(
            reqInfo.name,
            reqInfo.args as Record<string, unknown>,
          );
          if (hasPersistedPermission) {
            this.setStatusInternal(reqInfo.callId, 'scheduled');
          } else {
            const confirmationDetails = await toolInstance.shouldConfirmExecute(
              reqInfo.args,
              signal,
            );

            if (confirmationDetails) {
              const originalOnConfirm = confirmationDetails.onConfirm;
              const wrappedConfirmationDetails: ToolCallConfirmationDetails = {
                ...confirmationDetails,
                onConfirm: (
                  outcome: ToolConfirmationOutcome,
                  payload?: ToolConfirmationPayload,
                ) =>
                  this.handleConfirmationResponse(
                    reqInfo.callId,
                    originalOnConfirm,
                    outcome,
                    signal,
                    payload,
                  ),
              };
              this.setStatusInternal(
                reqInfo.callId,
                'awaiting_approval',
                wrappedConfirmationDetails,
              );
            } else {
              this.setStatusInternal(reqInfo.callId, 'scheduled');
            }
          }
        }
      } catch (error) {
        this.setStatusInternal(
          reqInfo.callId,
          'error',
          createErrorResponse(
            reqInfo,
            error instanceof Error ? error : new Error(String(error)),
          ),
        );
      }
    }
    this.attemptExecutionOfScheduledCalls(signal);
    this.checkAndNotifyCompletion();
  }

  async handleConfirmationResponse(
    callId: string,
    originalOnConfirm: (outcome: ToolConfirmationOutcome) => Promise<void>,
    outcome: ToolConfirmationOutcome,
    signal: AbortSignal,
    payload?: ToolConfirmationPayload,
  ): Promise<void> {
    const toolCall = this.toolCalls.find(
      (c) => c.request.callId === callId && c.status === 'awaiting_approval',
    );

    if (toolCall && toolCall.status === 'awaiting_approval') {
      await originalOnConfirm(outcome);
    }

    // Persist permission rules when the user selects "Always allow"
    if (
      outcome === ToolConfirmationOutcome.ProceedAlways ||
      outcome === ToolConfirmationOutcome.ProceedAlwaysTool ||
      outcome === ToolConfirmationOutcome.ProceedAlwaysServer
    ) {
      try {
        const permissionStore = getPermissionStore();
        const scope = scopeFromOutcome(outcome);
        await permissionStore.addRule(
          toolCall!.request.name,
          toolCall!.request.args as Record<string, unknown>,
          scope,
        );
      } catch {
        // Silently ignore persistence errors; in-memory approval still works
      }
    }

    this.toolCalls = this.toolCalls.map((call) => {
      if (call.request.callId !== callId) return call;
      return {
        ...call,
        outcome,
      };
    });

    if (outcome === ToolConfirmationOutcome.Cancel || signal.aborted) {
      this.setStatusInternal(
        callId,
        'cancelled',
        'User did not allow tool call',
      );
    } else if (outcome === ToolConfirmationOutcome.ModifyWithEditor) {
      const waitingToolCall = toolCall as WaitingToolCall;
      if (isModifiableTool(waitingToolCall.tool)) {
        const modifyContext = waitingToolCall.tool.getModifyContext(signal);
        const editorType = this.getPreferredEditor();
        if (!editorType) {
          return;
        }

        this.setStatusInternal(callId, 'awaiting_approval', {
          ...waitingToolCall.confirmationDetails,
          isModifying: true,
        } as ToolCallConfirmationDetails);

        const { updatedParams, updatedDiff } = await modifyWithEditor<
          typeof waitingToolCall.request.args
        >(
          waitingToolCall.request.args,
          modifyContext as ModifyContext<typeof waitingToolCall.request.args>,
          editorType,
          signal,
        );
        this.setArgsInternal(callId, updatedParams);
        this.setStatusInternal(callId, 'awaiting_approval', {
          ...waitingToolCall.confirmationDetails,
          fileDiff: updatedDiff,
          isModifying: false,
        } as ToolCallConfirmationDetails);
      }
    } else {
      // If the client provided new content, apply it before scheduling.
      if (payload?.newContent && toolCall) {
        await this._applyInlineModify(
          toolCall as WaitingToolCall,
          payload,
          signal,
        );
      }
      this.setStatusInternal(callId, 'scheduled');
    }
    this.attemptExecutionOfScheduledCalls(signal);
  }

  /**
   * Applies user-provided content changes to a tool call that is awaiting confirmation.
   * This method updates the tool's arguments and refreshes the confirmation prompt with a new diff
   * before the tool is scheduled for execution.
   * @private
   */
  private async _applyInlineModify(
    toolCall: WaitingToolCall,
    payload: ToolConfirmationPayload,
    signal: AbortSignal,
  ): Promise<void> {
    if (
      toolCall.confirmationDetails.type !== 'edit' ||
      !isModifiableTool(toolCall.tool)
    ) {
      return;
    }

    const modifyContext = toolCall.tool.getModifyContext(signal);
    const currentContent = await modifyContext.getCurrentContent(
      toolCall.request.args,
    );

    const updatedParams = modifyContext.createUpdatedParams(
      currentContent,
      payload.newContent,
      toolCall.request.args,
    );
    const updatedDiff = Diff.createPatch(
      modifyContext.getFilePath(toolCall.request.args),
      currentContent,
      payload.newContent,
      'Current',
      'Proposed',
    );

    this.setArgsInternal(toolCall.request.callId, updatedParams);
    this.setStatusInternal(toolCall.request.callId, 'awaiting_approval', {
      ...toolCall.confirmationDetails,
      fileDiff: updatedDiff,
    });
  }

  private attemptExecutionOfScheduledCalls(signal: AbortSignal): void {
    // Execute any scheduled tools immediately, without waiting for other
    // tools still in validating/awaiting_approval. Previously this method
    // required ALL tools to be final-or-scheduled before executing any,
    // which caused batch-blocking: unrelated tools were stuck waiting for
    // one approval prompt to resolve.
    const callsToExecute = this.toolCalls.filter(
      (call) => call.status === 'scheduled',
    );

    if (callsToExecute.length === 0) return;

    // Separate concurrency-safe and mutation tools for concurrent vs sequential execution
    // Uses isConcurrencySafe (finer-grained, parameter-aware) when available,
    // falls back to isReadOnly boolean for backward compatibility.
    const readOnlyCalls = callsToExecute.filter(
      (call) => {
        if (call.status !== 'scheduled') return false;
        if (call.tool?.isConcurrencySafe) {
          return call.tool.isConcurrencySafe(call.request.args as any);
        }
        return call.tool?.isReadOnly ?? false;
      },
    );
    const mutationCalls = callsToExecute.filter(
      (call) => {
        if (call.status !== 'scheduled') return false;
        if (call.tool?.isConcurrencySafe) {
          return !call.tool.isConcurrencySafe(call.request.args as any);
        }
        return !(call.tool?.isReadOnly ?? false);
      },
    );

    // Execute all read-only tools concurrently
    readOnlyCalls.forEach((toolCall) => {
      this.executeToolCall(toolCall as ScheduledToolCall, signal);
    });

    // Execute mutation tools sequentially — each starts only after the previous finishes
    const executeMutationsSequentially = async () => {
      for (const toolCall of mutationCalls) {
        if (signal.aborted) break;
        if (toolCall.status !== 'scheduled') continue;
        await this.executeToolCallAndWait(
          toolCall as ScheduledToolCall,
          signal,
        );
      }
    };

    // Fire and forget — completion is tracked via status changes
    executeMutationsSequentially().catch(() => {
      // Errors are handled per-tool in executeToolCallAndWait
    });
  }

  /**
   * Executes a tool call (fire-and-forget). Used for read-only tools that can run concurrently.
   */
  private executeToolCall(
    scheduledCall: ScheduledToolCall,
    signal: AbortSignal,
  ): void {
    const { callId, name: toolName } = scheduledCall.request;
    this.setStatusInternal(callId, 'executing');

    const liveOutputCallback = this.createLiveOutputCallback(
      scheduledCall,
      callId,
    );

    scheduledCall.tool
      .execute(scheduledCall.request.args, signal, liveOutputCallback)
      .then((toolResult: ToolResult) => this.handleToolSuccess(scheduledCall, toolResult, signal))
      .catch((executionError: Error) => this.handleToolError(scheduledCall, executionError));
  }

  /**
   * Executes a tool call and waits for it to complete. Used for mutation tools that must run sequentially.
   */
  private executeToolCallAndWait(
    scheduledCall: ScheduledToolCall,
    signal: AbortSignal,
  ): Promise<void> {
    const { callId, name: toolName } = scheduledCall.request;
    this.setStatusInternal(callId, 'executing');

    const liveOutputCallback = this.createLiveOutputCallback(
      scheduledCall,
      callId,
    );

    return scheduledCall.tool
      .execute(scheduledCall.request.args, signal, liveOutputCallback)
      .then((toolResult: ToolResult) => this.handleToolSuccess(scheduledCall, toolResult, signal))
      .catch((executionError: Error) => this.handleToolError(scheduledCall, executionError));
  }

  private createLiveOutputCallback(
    scheduledCall: ScheduledToolCall,
    callId: string,
  ): ((outputChunk: string) => void) | undefined {
    if (!scheduledCall.tool.canUpdateOutput || !this.outputUpdateHandler) {
      return undefined;
    }
    return (outputChunk: string) => {
      if (this.outputUpdateHandler) {
        this.outputUpdateHandler(callId, outputChunk);
      }
      this.toolCalls = this.toolCalls.map((tc) =>
        tc.request.callId === callId && tc.status === 'executing'
          ? { ...tc, liveOutput: outputChunk }
          : tc,
      );
      this.notifyToolCallsUpdate();
    };
  }

  private handleToolSuccess(
    scheduledCall: ScheduledToolCall,
    toolResult: ToolResult,
    signal: AbortSignal,
  ): void {
    const { callId, name: toolName } = scheduledCall.request;
    if (signal.aborted) {
      this.setStatusInternal(callId, 'cancelled', 'User cancelled tool execution.');
      return;
    }

    const response = convertToFunctionResponse(
      toolName,
      callId,
      toolResult.llmContent,
      scheduledCall.request.thought_signature,
    );
    const successResponse: ToolCallResponseInfo = {
      callId,
      responseParts: response,
      resultDisplay: toolResult.returnDisplay,
      error: undefined,
    };

    this.setStatusInternal(callId, 'success', successResponse);
  }

  private handleToolError(
    scheduledCall: ScheduledToolCall,
    executionError: Error,
  ): void {
    const { callId } = scheduledCall.request;
    this.setStatusInternal(
      callId,
      'error',
      createErrorResponse(
        scheduledCall.request,
        executionError instanceof Error
          ? executionError
          : new Error(String(executionError)),
      ),
    );
  }

  private checkAndNotifyCompletion(): void {
    const allCallsAreTerminal = this.toolCalls.every(
      (call) =>
        call.status === 'success' ||
        call.status === 'error' ||
        call.status === 'cancelled',
    );

    if (this.toolCalls.length > 0 && allCallsAreTerminal) {
      const completedCalls = [...this.toolCalls] as CompletedToolCall[];
      this.toolCalls = [];

      for (const call of completedCalls) {
        logToolCall(this.config, new ToolCallEvent(call));
      }

      if (this.onAllToolCallsComplete) {
        this.onAllToolCallsComplete(completedCalls);
      }
      this.notifyToolCallsUpdate();
    }
  }

  private notifyToolCallsUpdate(): void {
    if (this.onToolCallsUpdate) {
      this.onToolCallsUpdate([...this.toolCalls]);
    }
  }
}
