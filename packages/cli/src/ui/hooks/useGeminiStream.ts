/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { useInput } from 'ink';
import {
  Config,
  GeminiClient,
  GeminiEventType as ServerGeminiEventType,
  ServerGeminiStreamEvent as GeminiEvent,
  ServerGeminiContentEvent as ContentEvent,
  ServerGeminiErrorEvent as ErrorEvent,
  ServerGeminiChatCompressedEvent,
  ServerGeminiContextWarningEvent,
  getErrorMessage,
  isNodeError,
  MessageSenderType,
  ToolCallRequestInfo,
  logUserPrompt,
  GitService,
  EditorType,
  ThoughtSummary,
  UnauthorizedError,
  UserPromptEvent,
  DEFAULT_GEMINI_FLASH_MODEL,
  ToDoItem,
  getHookExecutor,
} from '@a-coder/core';
import { type Part, type PartListUnion } from '@google/genai';
import {
  StreamingState,
  HistoryItem,
  HistoryItemWithoutId,
  HistoryItemToolGroup,
  MessageType,
  SlashCommandProcessorResult,
  ToolCallStatus,
} from '../types.js';
import { isAtCommand } from '../utils/commandUtils.js';
import { parseAndFormatApiError, extractRetryAfterMs } from '../utils/errorParsing.js';
import { useShellCommandProcessor } from './shellCommandProcessor.js';
import { handleAtCommand } from './atCommandProcessor.js';
import { findLastSafeSplitPoint } from '../utils/markdownUtilities.js';
import { useStateAndRef } from './useStateAndRef.js';
import { UseHistoryManagerReturn } from './useHistoryManager.js';
import { useLogger } from './useLogger.js';
import { promises as fs } from 'fs';
import path from 'path';
import {
  useReactToolScheduler,
  mapToDisplay as mapTrackedToolCallsToDisplay,
  TrackedToolCall,
  TrackedCompletedToolCall,
  TrackedCancelledToolCall,
} from './useReactToolScheduler.js';
import { useSessionStats } from '../contexts/SessionContext.js';
import { STREAM_DEBOUNCE_MS } from '../constants.js';

export function mergePartListUnions(list: PartListUnion[]): PartListUnion {
  const resultParts: PartListUnion = [];
  for (const item of list) {
    if (Array.isArray(item)) {
      resultParts.push(...item);
    } else {
      resultParts.push(item);
    }
  }
  return resultParts;
}

enum StreamProcessingStatus {
  Completed,
  UserCancelled,
  Error,
}

/**
 * Manages the Gemini stream, including user input, command processing,
 * API interaction, and tool call lifecycle.
 */
export const useGeminiStream = (
  geminiClient: GeminiClient,
  history: HistoryItem[],
  addItem: UseHistoryManagerReturn['addItem'],
  setShowHelp: React.Dispatch<React.SetStateAction<boolean>>,
  config: Config,
  onDebugMessage: (message: string) => void,
  handleSlashCommand: (
    cmd: PartListUnion,
  ) => Promise<SlashCommandProcessorResult | false>,
  shellModeActive: boolean,
  getPreferredEditor: () => EditorType | undefined,
  onAuthError: () => void,
  performMemoryRefresh: () => Promise<void>,
  modelSwitchedFromQuotaError: boolean,
  setModelSwitchedFromQuotaError: React.Dispatch<React.SetStateAction<boolean>>,
  onContextWarning?: (tokens: number, limit: number) => void,
) => {
  const [initError, setInitError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const turnCancelledRef = useRef(false);
  const [isResponding, setIsResponding] = useState<boolean>(false);
  // Queue for completed tools that arrive while isResponding is true.
  // This prevents silently dropping tool results due to stale React state.
  const pendingCompletedToolsRef = useRef<TrackedToolCall[]>([]);
  const [thought, setThought] = useState<ThoughtSummary | null>(null);
  const [todos, setTodos] = useState<ToDoItem[]>([]);
  const [queryQueue, setQueryQueue] = useState<
    { query: PartListUnion; prompt_id?: string }[]
  >([]);
  const [pendingHistoryItemRef, setPendingHistoryItem] =
    useStateAndRef<HistoryItemWithoutId | null>(null);
  const processedMemoryToolsRef = useRef<Set<string>>(new Set());
  // Stream content debouncing: accumulate content chunks and flush
  // at a capped rate to reduce React re-renders during streaming.
  const streamDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingContentChunksRef = useRef<string[]>([]);
  const { startNewPrompt, getPromptCount } = useSessionStats();
  const logger = useLogger();
  const gitService = useMemo(() => {
    if (!config.getProjectRoot()) {
      return;
    }
    return new GitService(config.getProjectRoot());
  }, [config]);

  const [toolCalls, scheduleToolCalls, markToolsAsSubmitted] =
    useReactToolScheduler(
      async (completedToolCallsFromScheduler) => {
        // This onComplete is called when ALL scheduled tools for a given batch are done.
        if (completedToolCallsFromScheduler.length > 0) {
          // Add the final state of these tools to the history for display.
          addItem(
            mapTrackedToolCallsToDisplay(
              completedToolCallsFromScheduler as TrackedToolCall[],
            ),
            Date.now(),
          );

          // Handle tool response submission immediately when tools complete
          await handleCompletedTools(
            completedToolCallsFromScheduler as TrackedToolCall[],
          );
        }
      },
      config,
      setPendingHistoryItem,
      getPreferredEditor,
    );

  const pendingToolCallGroupDisplay = useMemo(
    () =>
      toolCalls.length ? mapTrackedToolCallsToDisplay(toolCalls) : undefined,
    [toolCalls],
  );

  // Memoize pending history items to avoid fresh allocation on every render.
  // pendingHistoryItemRef.current is updated synchronously before the state change
  // that triggers re-render, so reading it inside useMemo is safe.
  const pendingHistoryItems = useMemo<HistoryItemWithoutId[]>(() => {
    const items: HistoryItemWithoutId[] = [];
    if (pendingHistoryItemRef.current) {
      items.push(pendingHistoryItemRef.current);
    }
    if (pendingToolCallGroupDisplay) {
      items.push(pendingToolCallGroupDisplay);
    }
    return items;
  }, [pendingToolCallGroupDisplay]);

  const isProcessingQueueRef = useRef(false);

  const onExec = useCallback(async (done: Promise<void>) => {
    setIsResponding(true);
    await done;
    setIsResponding(false);
  }, []);
  const { handleShellCommand } = useShellCommandProcessor(
    addItem,
    setPendingHistoryItem,
    onExec,
    onDebugMessage,
    config,
    geminiClient,
  );

  const streamingState = useMemo(() => {
    if (toolCalls.some((tc) => tc.status === 'awaiting_approval')) {
      return StreamingState.WaitingForConfirmation;
    }
    if (
      isResponding ||
      toolCalls.some(
        (tc) =>
          tc.status === 'executing' ||
          tc.status === 'scheduled' ||
          tc.status === 'validating' ||
          ((tc.status === 'success' ||
            tc.status === 'error' ||
            tc.status === 'cancelled') &&
            !(tc as TrackedCompletedToolCall | TrackedCancelledToolCall)
              .responseSubmittedToGemini),
      )
    ) {
      return StreamingState.Responding;
    }
    return StreamingState.Idle;
  }, [isResponding, toolCalls]);

  // Terminal bell notification when streaming completes (user may have switched windows)
  const wasRespondingRef = useRef(false);
  useEffect(() => {
    const isCurrentlyResponding =
      streamingState === StreamingState.Responding ||
      streamingState === StreamingState.WaitingForConfirmation;
    if (wasRespondingRef.current && !isCurrentlyResponding) {
      try {
        process.stdout.write('\x07');
      } catch {
        // Ignore if stdout is not available
      }
    }
    wasRespondingRef.current = isCurrentlyResponding;
  }, [streamingState]);

  const cancelCurrentTask = useCallback(() => {
    if (
      streamingState === StreamingState.Responding ||
      streamingState === StreamingState.WaitingForConfirmation
    ) {
      turnCancelledRef.current = true;
      abortControllerRef.current?.abort();

      if (pendingHistoryItemRef.current) {
        addItem(pendingHistoryItemRef.current, Date.now());
      }
      addItem(
        {
          type: MessageType.INFO,
          text: 'Request cancelled.',
        },
        Date.now(),
      );
      setPendingHistoryItem(null);
      setIsResponding(false);
    }
  }, [
    streamingState,
    pendingHistoryItemRef,
    addItem,
    setPendingHistoryItem,
    setIsResponding,
  ]);

  useInput((_input, key) => {
    if (key.escape) {
      // When waiting for tool confirmation, Escape cancels the confirmation
      // (handled by ToolConfirmationMessage's useInput), not the entire stream.
      if (streamingState === StreamingState.WaitingForConfirmation) {
        return;
      }
      cancelCurrentTask();
    }
  });

  const prepareQueryForGemini = useCallback(
    async (
      query: PartListUnion,
      userMessageTimestamp: number,
      abortSignal: AbortSignal,
      prompt_id: string,
      alreadyAddedToHistory?: boolean,
    ): Promise<{
      queryToSend: PartListUnion | null;
      shouldProceed: boolean;
    }> => {
      if (turnCancelledRef.current) {
        return { queryToSend: null, shouldProceed: false };
      }
      if (typeof query === 'string' && query.trim().length === 0) {
        return { queryToSend: null, shouldProceed: false };
      }

      let localQueryToSendToGemini: PartListUnion | null = null;

      if (typeof query === 'string') {
        const trimmedQuery = query.trim();
        logUserPrompt(
          config,
          new UserPromptEvent(
            trimmedQuery.length,
            prompt_id,
            config.getContentGeneratorConfig()?.authType,
            trimmedQuery,
          ),
        );
        onDebugMessage(`User query: '${trimmedQuery}'`);
        await logger?.logMessage(MessageSenderType.USER, trimmedQuery);

        // Handle UI-only commands first
        const slashCommandResult = await handleSlashCommand(trimmedQuery);

        if (slashCommandResult) {
          if (slashCommandResult.type === 'schedule_tool') {
            const { toolName, toolArgs } = slashCommandResult;

            // Determine if this should be client-initiated:
            // 1. If isClientInitiated is explicitly set, use that value
            // 2. For skills with 'execute' action, default to false (LLM should process result)
            // 3. Otherwise default to true (client-initiated, LLM doesn't process)
            let isClientInitiated = true;

            if ('isClientInitiated' in slashCommandResult) {
              isClientInitiated = slashCommandResult.isClientInitiated ?? true;
            } else {
              // Skills with 'execute' action should NOT be client-initiated
              // so the LLM processes the skill content and acts on it
              const isSkillExecute =
                toolName === 'skills' &&
                typeof toolArgs === 'object' &&
                (toolArgs as any).action === 'execute';

              isClientInitiated = !isSkillExecute;
            }

            const toolCallRequest: ToolCallRequestInfo = {
              callId: `${toolName}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
              name: toolName,
              args: toolArgs,
              isClientInitiated,
              prompt_id,
            };
            scheduleToolCalls([toolCallRequest], abortSignal);
          }

          return { queryToSend: null, shouldProceed: false };
        }

        if (shellModeActive && handleShellCommand(trimmedQuery, abortSignal)) {
          return { queryToSend: null, shouldProceed: false };
        }

        // Handle @-commands (which might involve tool calls)
        // Pass the original query (not trimmedQuery) to preserve pastedInfo
        if (isAtCommand(trimmedQuery)) {
          const atCommandResult = await handleAtCommand({
            query: query as string,
            config,
            addItem,
            onDebugMessage,
            messageId: userMessageTimestamp,
            signal: abortSignal,
          });
          if (!atCommandResult.shouldProceed) {
            return { queryToSend: null, shouldProceed: false };
          }
          localQueryToSendToGemini = atCommandResult.processedQuery;
        } else {
          // Normal query for Gemini
          if (!alreadyAddedToHistory) {
            // Check for paste info from InputPrompt
            const pasteInfo = (query as unknown as { pastedInfo?: { pasteId: number; lineCount: number } }).pastedInfo;
            addItem(
              {
                type: MessageType.USER,
                text: trimmedQuery,
                ...(pasteInfo && { pastedInfo: pasteInfo }),
              },
              userMessageTimestamp,
            );
          }
          localQueryToSendToGemini = trimmedQuery;
        }
      } else {
        // It's a function response (PartListUnion that isn't a string)
        localQueryToSendToGemini = query;
      }

      if (localQueryToSendToGemini === null) {
        onDebugMessage(
          'Query processing resulted in null, not sending to Gemini.',
        );
        return { queryToSend: null, shouldProceed: false };
      }
      return { queryToSend: localQueryToSendToGemini, shouldProceed: true };
    },
    [
      config,
      addItem,
      onDebugMessage,
      handleShellCommand,
      handleSlashCommand,
      logger,
      shellModeActive,
      scheduleToolCalls,
    ],
  );

  // --- Stream Event Handlers ---

  /**
   * Flushes accumulated content chunks to the pending history item.
   * Called by the debounce timer or immediately on split points / stream end.
   */
  const flushStreamContent = useCallback(
    (userMessageTimestamp: number) => {
      const chunks = pendingContentChunksRef.current;
      if (chunks.length === 0) return;
      pendingContentChunksRef.current = [];

      const accumulated = chunks.join('');

      if (turnCancelledRef.current) {
        return;
      }

      if (
        pendingHistoryItemRef.current?.type !== 'gemini' &&
        pendingHistoryItemRef.current?.type !== 'gemini_content'
      ) {
        if (pendingHistoryItemRef.current) {
          addItem(pendingHistoryItemRef.current, userMessageTimestamp);
        }
        setPendingHistoryItem({ type: 'gemini', text: accumulated });
      } else {
        // Append accumulated content to existing pending item
        setPendingHistoryItem((item) => ({
          type: item?.type as 'gemini' | 'gemini_content',
          text: (item?.text ?? '') + accumulated,
        }));
      }
    },
    [addItem, pendingHistoryItemRef, setPendingHistoryItem],
  );

  const handleContentEvent = useCallback(
    (
      eventValue: ContentEvent['value'],
      currentGeminiMessageBuffer: string,
      userMessageTimestamp: number,
    ): string => {
      if (turnCancelledRef.current) {
        return '';
      }

      let newGeminiMessageBuffer = currentGeminiMessageBuffer + eventValue;

      if (
        pendingHistoryItemRef.current?.type !== 'gemini' &&
        pendingHistoryItemRef.current?.type !== 'gemini_content'
      ) {
        if (pendingHistoryItemRef.current) {
          addItem(pendingHistoryItemRef.current, userMessageTimestamp);
        }
        setPendingHistoryItem({ type: 'gemini', text: '' });
        newGeminiMessageBuffer = eventValue;
      }

      // Check for split point — if found, flush immediately to promote to <Static>
      const splitPoint = findLastSafeSplitPoint(newGeminiMessageBuffer);

      if (splitPoint < newGeminiMessageBuffer.length) {
        // Split point found — flush any buffered chunks, then handle the split
        if (streamDebounceTimerRef.current) {
          clearTimeout(streamDebounceTimerRef.current);
          streamDebounceTimerRef.current = null;
        }
        pendingContentChunksRef.current = [];

        const beforeText = newGeminiMessageBuffer.substring(0, splitPoint);
        const afterText = newGeminiMessageBuffer.substring(splitPoint);
        addItem(
          {
            type: pendingHistoryItemRef.current?.type as
              | 'gemini'
              | 'gemini_content',
            text: beforeText,
          },
          userMessageTimestamp,
        );
        setPendingHistoryItem({ type: 'gemini_content', text: afterText });
        return afterText;
      }

      // No split point — buffer the chunk and debounce the UI update
      pendingContentChunksRef.current.push(eventValue);

      if (streamDebounceTimerRef.current) {
        clearTimeout(streamDebounceTimerRef.current);
      }
      streamDebounceTimerRef.current = setTimeout(() => {
        streamDebounceTimerRef.current = null;
        flushStreamContent(userMessageTimestamp);
      }, STREAM_DEBOUNCE_MS);

      return newGeminiMessageBuffer;
    },
    [addItem, pendingHistoryItemRef, setPendingHistoryItem, flushStreamContent],
  );

  const handleUserCancelledEvent = useCallback(
    (userMessageTimestamp: number) => {
      if (turnCancelledRef.current) {
        return;
      }
      // Flush any pending content before handling cancellation
      if (streamDebounceTimerRef.current) {
        clearTimeout(streamDebounceTimerRef.current);
        streamDebounceTimerRef.current = null;
      }
      if (pendingContentChunksRef.current.length > 0) {
        flushStreamContent(userMessageTimestamp);
      }
      if (pendingHistoryItemRef.current) {
        if (pendingHistoryItemRef.current.type === 'tool_group') {
          const updatedTools = pendingHistoryItemRef.current.tools.map(
            (tool) =>
              tool.status === ToolCallStatus.Pending ||
              tool.status === ToolCallStatus.Confirming ||
              tool.status === ToolCallStatus.Executing
                ? { ...tool, status: ToolCallStatus.Canceled }
                : tool,
          );
          const pendingItem: HistoryItemToolGroup = {
            ...pendingHistoryItemRef.current,
            tools: updatedTools,
          };
          addItem(pendingItem, userMessageTimestamp);
        } else {
          addItem(pendingHistoryItemRef.current, userMessageTimestamp);
        }
        setPendingHistoryItem(null);
      }
      addItem(
        { type: MessageType.INFO, text: 'User cancelled the request.' },
        userMessageTimestamp,
      );
      setIsResponding(false);
    },
    [addItem, pendingHistoryItemRef, setPendingHistoryItem, flushStreamContent],
  );

  const handleErrorEvent = useCallback(
    (eventValue: ErrorEvent['value'], userMessageTimestamp: number) => {
      if (pendingHistoryItemRef.current) {
        addItem(pendingHistoryItemRef.current, userMessageTimestamp);
        setPendingHistoryItem(null);
      }
      const retryAfterMs = extractRetryAfterMs(eventValue.error);
      addItem(
        {
          type: MessageType.ERROR,
          text: parseAndFormatApiError(
            eventValue.error,
            config.getContentGeneratorConfig()?.authType,
            undefined,
            config.getModel(),
            DEFAULT_GEMINI_FLASH_MODEL,
          ),
          ...(retryAfterMs > 0 ? { retryAfterMs } : {}),
      },
        userMessageTimestamp,
      );
    },
    [addItem, pendingHistoryItemRef, setPendingHistoryItem, config],
  );

  const handleChatCompressionEvent = useCallback(
    (eventValue: ServerGeminiChatCompressedEvent['value']) =>
      addItem(
        {
          type: 'info',
          text:
            `IMPORTANT: This conversation approached the input token limit for ${config.getModel()}. ` +
            `A compressed context will be sent for future messages (compressed from: ` +
            `${eventValue?.originalTokenCount ?? 'unknown'} to ` +
            `${eventValue?.newTokenCount ?? 'unknown'} tokens).`,
        },
        Date.now(),
      ),
    [addItem, config],
  );

  const handleMaxSessionTurnsEvent = useCallback(
    () =>
      addItem(
        {
          type: 'info',
          text:
            `The session has reached the maximum number of turns: ${config.getMaxSessionTurns()}. ` +
            `Please update this limit in your setting.json file.`,
        },
        Date.now(),
      ),
    [addItem, config],
  );

  const handleContextWarningEvent = useCallback(
    (event: ServerGeminiContextWarningEvent) => {
      const { event: eventType, currentTokens, tokenLimit } = event.value;
      const percentage = (event.value.percentage * 100).toFixed(0);

      // Call the callback to update contextUsage in App.tsx
      if (onContextWarning) {
        onContextWarning(currentTokens, tokenLimit);
      }

      let message = '';
      if (eventType === 'warning') {
        message = `Context usage is at ${percentage}% (${currentTokens}/${tokenLimit} tokens). Consider using /compress to free up space.`;
      } else if (eventType === 'critical') {
        message = `Context usage is at ${percentage}% (${currentTokens}/${tokenLimit} tokens). Approaching token limit. Use /compress to free up space, or start a new conversation.`;
      } else if (eventType === 'auto_compress') {
        message = `Auto-compressing chat history (${percentage}% of ${tokenLimit} tokens)...`;
      }

      if (message) {
        addItem(
          {
            type: eventType === 'auto_compress' ? 'info' : 'error',
            text: message,
          },
          Date.now(),
        );
      }
    },
    [addItem, onContextWarning],
  );

  const processGeminiStreamEvents = useCallback(
    async (
      stream: AsyncIterable<GeminiEvent>,
      userMessageTimestamp: number,
      signal: AbortSignal,
    ): Promise<StreamProcessingStatus> => {
      let geminiMessageBuffer = '';
      const toolCallRequests: ToolCallRequestInfo[] = [];
      let wasCancelled = false;
      let lastThoughtUpdate = 0;
      const THOUGHT_THROTTLE_MS = 200; // Throttle thought UI updates to avoid excessive re-renders
      for await (const event of stream) {
        switch (event.type) {
          case ServerGeminiEventType.Thought:
            // Safely handle thought events without failing the stream
            try {
              if (!config.getHideThinking()) {
                // Throttle thought updates to avoid excessive re-renders during
                // long reasoning phases that can cause OOM
                const now = Date.now();
                if (now - lastThoughtUpdate >= THOUGHT_THROTTLE_MS) {
                  lastThoughtUpdate = now;
                  // Truncate description to prevent large strings in React state
                  const MAX_THOUGHT_DISPLAY_LENGTH = 2000;
                  const desc = event.value.description;
                  const truncatedDesc = desc.length > MAX_THOUGHT_DISPLAY_LENGTH
                    ? desc.slice(-MAX_THOUGHT_DISPLAY_LENGTH)
                    : desc;
                  setThought({ subject: event.value.subject, description: truncatedDesc });
                }
              }
            } catch (e) {
              // Silently fail on thought events to not interrupt the stream
              console.error('Error in thought event:', e);
              // Also set the thought to null to reset display
              try {
                setThought(null);
              } catch (resetError) {
                // If resetting fails, just ignore
              }
            }
            break;
          case ServerGeminiEventType.Content:
            // Hide thoughts as soon as content starts arriving
            setThought(null);
            geminiMessageBuffer = handleContentEvent(
              event.value,
              geminiMessageBuffer,
              userMessageTimestamp,
            );
            break;
          case ServerGeminiEventType.ToolCallRequest:
            if (event.value.name === 'write_todos') {
              const newTodos = (event.value.args as any).todos as ToDoItem[];
              if (Array.isArray(newTodos)) {
                setTodos(newTodos);
              }
            }
            toolCallRequests.push(event.value);
            break;
          case ServerGeminiEventType.UserCancelled:
            handleUserCancelledEvent(userMessageTimestamp);
            wasCancelled = true;
            break;
          case ServerGeminiEventType.Error:
            handleErrorEvent(event.value, userMessageTimestamp);
            break;
          case ServerGeminiEventType.ChatCompressed:
            handleChatCompressionEvent(event.value);
            break;
          case ServerGeminiEventType.ToolCallConfirmation:
          case ServerGeminiEventType.ToolCallResponse:
            // do nothing
            break;
          case ServerGeminiEventType.MaxSessionTurns:
            handleMaxSessionTurnsEvent();
            break;
          case ServerGeminiEventType.LoopDetected:
            // Silently handled — the core injects a user message to break the loop
            break;
          case ServerGeminiEventType.ContextWarning:
            handleContextWarningEvent(event);
            break;
          default: {
            // enforces exhaustive switch-case
            const unreachable: never = event;
            return unreachable;
          }
        }
      }
      if (toolCallRequests.length > 0) {
        scheduleToolCalls(toolCallRequests, signal);
      }
      return wasCancelled
        ? StreamProcessingStatus.UserCancelled
        : StreamProcessingStatus.Completed;
    },
    [
      handleContentEvent,
      handleUserCancelledEvent,
      handleErrorEvent,
      scheduleToolCalls,
      handleChatCompressionEvent,
      handleMaxSessionTurnsEvent,
      handleContextWarningEvent,
    ],
  );

  const submitQuery = useCallback(
    async (
      query: PartListUnion,
      options?: { isContinuation?: boolean; alreadyAddedToHistory?: boolean },
      prompt_id?: string,
    ) => {
      const isBusy =
        streamingState === StreamingState.Responding ||
        streamingState === StreamingState.WaitingForConfirmation;

      if (isBusy && !options?.isContinuation) {
        setQueryQueue((prev) => [...prev, { query, prompt_id }]);
        return;
      }

      const userMessageTimestamp = Date.now();
      setShowHelp(false);

      // Reset quota error flag when starting a new query (not a continuation)
      if (!options?.isContinuation) {
        setModelSwitchedFromQuotaError(false);
        config.setQuotaErrorOccurred(false);
        setTodos([]);
      }

      abortControllerRef.current = new AbortController();
      const abortSignal = abortControllerRef.current.signal;
      turnCancelledRef.current = false;

      if (!prompt_id) {
        prompt_id = config.getSessionId() + '########' + getPromptCount();
      }

      const { queryToSend, shouldProceed } = await prepareQueryForGemini(
        query,
        userMessageTimestamp,
        abortSignal,
        prompt_id!,
        options?.alreadyAddedToHistory,
      );

      if (!shouldProceed || queryToSend === null) {
        return;
      }

      if (!options?.isContinuation) {
        startNewPrompt();
      }

      setIsResponding(true);
      setInitError(null);

      // Execute UserPromptSubmit hooks for Dash integration
      try {
        const hookExecutor = getHookExecutor(config.getSessionId(), config.getTargetDir());
        const promptText = typeof query === 'string' ? query : '';
        await hookExecutor.executeUserPromptSubmitHooks(promptText);
      } catch (hookError) {
        // Don't let hook errors affect the main flow
        console.error('[HookExecutor] UserPromptSubmit hook error:', hookError);
      }

      try {
        const stream = geminiClient.sendMessageStream(
          queryToSend,
          abortSignal,
          prompt_id!,
        );
        const processingStatus = await processGeminiStreamEvents(
          stream,
          userMessageTimestamp,
          abortSignal,
        );

        if (processingStatus === StreamProcessingStatus.UserCancelled) {
          return;
        }


        // Clear thought state after stream completes
        setThought(null);

        // Flush any remaining debounced content before committing
        if (streamDebounceTimerRef.current) {
          clearTimeout(streamDebounceTimerRef.current);
          streamDebounceTimerRef.current = null;
        }
        if (pendingContentChunksRef.current.length > 0) {
          flushStreamContent(userMessageTimestamp);
        }

        if (pendingHistoryItemRef.current) {
          addItem(pendingHistoryItemRef.current, userMessageTimestamp);
          setPendingHistoryItem(null);
        }
      } catch (error: unknown) {
        if (error instanceof UnauthorizedError) {
          onAuthError();
        } else if (!isNodeError(error) || error.name !== 'AbortError') {
          addItem(
            {
              type: MessageType.ERROR,
              text: parseAndFormatApiError(
                getErrorMessage(error) || 'Unknown error',
                config.getContentGeneratorConfig()?.authType,
                undefined,
                config.getModel(),
                DEFAULT_GEMINI_FLASH_MODEL,
              ),
            },
            userMessageTimestamp,
          );
        }
      } finally {
        setIsResponding(false);

        // Execute Stop hooks for Dash integration
        try {
          const hookExecutor = getHookExecutor(config.getSessionId(), config.getTargetDir());
          await hookExecutor.executeStopHooks();
        } catch (hookError) {
          // Don't let hook errors affect the main flow
          console.error('[HookExecutor] Stop hook error:', hookError);
        }
      }
    },
    [
      streamingState,
      setShowHelp,
      setModelSwitchedFromQuotaError,
      prepareQueryForGemini,
      processGeminiStreamEvents,
      pendingHistoryItemRef,
      addItem,
      setPendingHistoryItem,
      setInitError,
      geminiClient,
      onAuthError,
      config,
      startNewPrompt,
      getPromptCount,
    ],
  );

  useEffect(() => {
    const processQueue = async () => {
      if (
        streamingState === StreamingState.Idle &&
        queryQueue.length > 0 &&
        !isProcessingQueueRef.current
      ) {
        isProcessingQueueRef.current = true;
        const next = queryQueue[0];
        
        // Remove from queue first to update UI
        setQueryQueue((prev) => prev.slice(1));

        try {
          await submitQuery(
            next.query,
            { alreadyAddedToHistory: false },
            next.prompt_id,
          );
        } finally {
          isProcessingQueueRef.current = false;
        }
      }
    };

    processQueue();
  }, [streamingState, queryQueue.length, submitQuery]);

  const handleCompletedTools = useCallback(
    async (completedToolCallsFromScheduler: TrackedToolCall[]) => {
      if (isResponding) {
        // Queue the results instead of silently dropping them.
        // They'll be processed once isResponding becomes false.
        pendingCompletedToolsRef.current.push(...completedToolCallsFromScheduler);
        return;
      }

      const completedAndReadyToSubmitTools =
        completedToolCallsFromScheduler.filter(
          (
            tc: TrackedToolCall,
          ): tc is TrackedCompletedToolCall | TrackedCancelledToolCall => {
            const isTerminalState =
              tc.status === 'success' ||
              tc.status === 'error' ||
              tc.status === 'cancelled';

            if (isTerminalState) {
              const completedOrCancelledCall = tc as
                | TrackedCompletedToolCall
                | TrackedCancelledToolCall;
              return (
                completedOrCancelledCall.response?.responseParts !== undefined
              );
            }
            return false;
          },
        );

      // Finalize any client-initiated tools as soon as they are done.
      const clientTools = completedAndReadyToSubmitTools.filter(
        (t) => t.request.isClientInitiated,
      );
      if (clientTools.length > 0) {
        markToolsAsSubmitted(clientTools.map((t) => t.request.callId));
      }

      // Identify new, successful save_memory calls that we haven't processed yet.
      const newSuccessfulMemorySaves = completedAndReadyToSubmitTools.filter(
        (t) =>
          t.request.name === 'save_memory' &&
          t.status === 'success' &&
          !processedMemoryToolsRef.current.has(t.request.callId),
      );

      if (newSuccessfulMemorySaves.length > 0) {
        // Perform the refresh only if there are new ones.
        void performMemoryRefresh();
        // Mark them as processed so we don't do this again on the next render.
        newSuccessfulMemorySaves.forEach((t) =>
          processedMemoryToolsRef.current.add(t.request.callId),
        );
      }

      const geminiTools = completedAndReadyToSubmitTools.filter(
        (t) => !t.request.isClientInitiated,
      );

      if (geminiTools.length === 0) {
        return;
      }

      // If all the tools were cancelled, don't submit a response to Gemini.
      const allToolsCancelled = geminiTools.every(
        (tc) => tc.status === 'cancelled',
      );

      if (allToolsCancelled) {
        if (geminiClient) {
          // We need to manually add the function responses to the history
          // so the model knows the tools were cancelled.
          const responsesToAdd = geminiTools.flatMap(
            (toolCall) => toolCall.response.responseParts,
          );
          const combinedParts: Part[] = [];
          for (const response of responsesToAdd) {
            if (Array.isArray(response)) {
              combinedParts.push(...response);
            } else if (typeof response === 'string') {
              combinedParts.push({ text: response });
            } else {
              combinedParts.push(response);
            }
          }
          geminiClient.addHistory({
            role: 'user',
            parts: combinedParts,
          });
        }

        const callIdsToMarkAsSubmitted = geminiTools.map(
          (toolCall) => toolCall.request.callId,
        );
        markToolsAsSubmitted(callIdsToMarkAsSubmitted);
        return;
      }

      const responsesToSend: PartListUnion[] = geminiTools.map(
        (toolCall) => toolCall.response.responseParts,
      );
      const callIdsToMarkAsSubmitted = geminiTools.map(
        (toolCall) => toolCall.request.callId,
      );

      const prompt_ids = geminiTools.map(
        (toolCall) => toolCall.request.prompt_id,
      );

      markToolsAsSubmitted(callIdsToMarkAsSubmitted);

      // Don't continue if model was switched due to quota error
      if (modelSwitchedFromQuotaError) {
        return;
      }

      submitQuery(
        mergePartListUnions(responsesToSend),
        {
          isContinuation: true,
        },
        prompt_ids[0],
      );
    },
    [
      isResponding,
      submitQuery,
      markToolsAsSubmitted,
      geminiClient,
      performMemoryRefresh,
      modelSwitchedFromQuotaError,
    ],
  );

  // Process any queued completed tools once isResponding becomes false.
  // This handles the race condition where tools complete while React state
  // still shows isResponding=true (stale closure), which previously caused
  // tool results to be silently dropped and the CLI to hang.
  useEffect(() => {
    if (!isResponding && pendingCompletedToolsRef.current.length > 0) {
      const pending = pendingCompletedToolsRef.current.splice(0);
      handleCompletedTools(pending);
    }
  }, [isResponding, handleCompletedTools]);

  useEffect(() => {
    const saveRestorableToolCalls = async () => {
      if (!config.getCheckpointingEnabled()) {
        return;
      }
      const restorableToolCalls = toolCalls.filter(
        (toolCall) =>
          (toolCall.request.name === 'replace' ||
            toolCall.request.name === 'write_file') &&
          toolCall.status === 'awaiting_approval',
      );

      if (restorableToolCalls.length > 0) {
        const checkpointDir = config.getProjectTempDir()
          ? path.join(config.getProjectTempDir(), 'checkpoints')
          : undefined;

        if (!checkpointDir) {
          return;
        }

        try {
          await fs.mkdir(checkpointDir, { recursive: true });
        } catch (error) {
          if (!isNodeError(error) || error.code !== 'EEXIST') {
            onDebugMessage(
              `Failed to create checkpoint directory: ${getErrorMessage(error)}`,
            );
            return;
          }
        }

        for (const toolCall of restorableToolCalls) {
          const filePath = toolCall.request.args['file_path'] as string;
          if (!filePath) {
            onDebugMessage(
              `Skipping restorable tool call due to missing file_path: ${toolCall.request.name}`,
            );
            continue;
          }

          try {
            let commitHash = await gitService?.createFileSnapshot(
              `Snapshot for ${toolCall.request.name}`,
            );

            if (!commitHash) {
              commitHash = await gitService?.getCurrentCommitHash();
            }

            if (!commitHash) {
              onDebugMessage(
                `Failed to create snapshot for ${filePath}. Skipping restorable tool call.`,
              );
              continue;
            }

            const timestamp = new Date()
              .toISOString()
              .replace(/:/g, '-')
              .replace(/\./g, '_');
            const toolName = toolCall.request.name;
            const fileName = path.basename(filePath);
            const toolCallWithSnapshotFileName = `${timestamp}-${fileName}-${toolName}.json`;
            const clientHistory = await geminiClient?.getHistory();
            const toolCallWithSnapshotFilePath = path.join(
              checkpointDir,
              toolCallWithSnapshotFileName,
            );

            await fs.writeFile(
              toolCallWithSnapshotFilePath,
              JSON.stringify(
                {
                  history,
                  clientHistory,
                  toolCall: {
                    name: toolCall.request.name,
                    args: toolCall.request.args,
                  },
                  commitHash,
                  filePath,
                },
                null,
                2,
              ),
            );
          } catch (error) {
            onDebugMessage(
              `Failed to write restorable tool call file: ${getErrorMessage(
                error,
              )}`,
            );
          }
        }
      }
    };
    saveRestorableToolCalls();
  }, [toolCalls, config, onDebugMessage, gitService, history, geminiClient]);

  return {
    streamingState,
    submitQuery,
    cancelCurrentTask,
    initError,
    pendingHistoryItems,
    thought,
    todos,
    queryQueue,
  };
};
