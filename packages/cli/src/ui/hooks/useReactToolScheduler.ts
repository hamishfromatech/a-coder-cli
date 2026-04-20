/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Config,
  ToolCallRequestInfo,
  ExecutingToolCall,
  ScheduledToolCall,
  ValidatingToolCall,
  WaitingToolCall,
  CompletedToolCall,
  CancelledToolCall,
  CoreToolScheduler,
  OutputUpdateHandler,
  AllToolCallsCompleteHandler,
  ToolCallsUpdateHandler,
  Tool,
  ToolCall,
  Status as CoreStatus,
  EditorType,
} from '@a-coder/core';
import { useCallback, useState, useMemo, useRef } from 'react';
import {
  HistoryItemToolGroup,
  IndividualToolCallDisplay,
  ToolCallStatus,
  HistoryItemWithoutId,
} from '../types.js';

export type ScheduleFn = (
  request: ToolCallRequestInfo | ToolCallRequestInfo[],
  signal: AbortSignal,
) => void;
export type MarkToolsAsSubmittedFn = (callIds: string[]) => void;

export type TrackedScheduledToolCall = ScheduledToolCall & {
  responseSubmittedToGemini?: boolean;
};
export type TrackedValidatingToolCall = ValidatingToolCall & {
  responseSubmittedToGemini?: boolean;
};
export type TrackedWaitingToolCall = WaitingToolCall & {
  responseSubmittedToGemini?: boolean;
};
export type TrackedExecutingToolCall = ExecutingToolCall & {
  responseSubmittedToGemini?: boolean;
};
export type TrackedCompletedToolCall = CompletedToolCall & {
  responseSubmittedToGemini?: boolean;
};
export type TrackedCancelledToolCall = CancelledToolCall & {
  responseSubmittedToGemini?: boolean;
};

export type TrackedToolCall =
  | TrackedScheduledToolCall
  | TrackedValidatingToolCall
  | TrackedWaitingToolCall
  | TrackedExecutingToolCall
  | TrackedCompletedToolCall
  | TrackedCancelledToolCall;

export function useReactToolScheduler(
  onComplete: (tools: CompletedToolCall[]) => void,
  config: Config,
  setPendingHistoryItem: React.Dispatch<
    React.SetStateAction<HistoryItemWithoutId | null>
  >,
  getPreferredEditor: () => EditorType | undefined,
): [TrackedToolCall[], ScheduleFn, MarkToolsAsSubmittedFn] {
  const [toolCallsForDisplay, setToolCallsForDisplay] = useState<
    TrackedToolCall[]
  >([]);

  // Debounce tool output updates to reduce React re-renders
  const TOOL_OUTPUT_DEBOUNCE_MS = 50;
  const outputDebounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingOutputUpdatesRef = useRef<Map<string, string>>(new Map());

  const flushOutputUpdates = useCallback(() => {
    if (pendingOutputUpdatesRef.current.size === 0) return;

    const updates = new Map(pendingOutputUpdatesRef.current);
    pendingOutputUpdatesRef.current.clear();

    setPendingHistoryItem((prevItem) => {
      if (prevItem?.type === 'tool_group') {
        return {
          ...prevItem,
          tools: prevItem.tools.map((toolDisplay) => {
            const update = updates.get(toolDisplay.callId);
            if (update !== undefined && toolDisplay.status === ToolCallStatus.Executing) {
              return { ...toolDisplay, resultDisplay: update };
            }
            return toolDisplay;
          }),
        };
      }
      return prevItem;
    });

    setToolCallsForDisplay((prevCalls) =>
      prevCalls.map((tc) => {
        if (tc.status === 'executing') {
          const update = updates.get(tc.request.callId);
          if (update !== undefined) {
            const executingTc = tc as TrackedExecutingToolCall;
            return { ...executingTc, liveOutput: update };
          }
        }
        return tc;
      }),
    );
  }, [setPendingHistoryItem]);

  const outputUpdateHandler: OutputUpdateHandler = useCallback(
    (toolCallId, outputChunk) => {
      // Buffer the update
      pendingOutputUpdatesRef.current.set(toolCallId, outputChunk);

      // Debounce the flush
      if (outputDebounceTimerRef.current) {
        clearTimeout(outputDebounceTimerRef.current);
      }
      outputDebounceTimerRef.current = setTimeout(() => {
        outputDebounceTimerRef.current = null;
        flushOutputUpdates();
      }, TOOL_OUTPUT_DEBOUNCE_MS);
    },
    [flushOutputUpdates],
  );

  const allToolCallsCompleteHandler: AllToolCallsCompleteHandler = useCallback(
    (completedToolCalls) => {
      // Flush any pending output updates before completion
      if (outputDebounceTimerRef.current) {
        clearTimeout(outputDebounceTimerRef.current);
        outputDebounceTimerRef.current = null;
      }
      flushOutputUpdates();
      onComplete(completedToolCalls);
    },
    [onComplete, flushOutputUpdates],
  );

  const toolCallsUpdateHandler: ToolCallsUpdateHandler = useCallback(
    (updatedCoreToolCalls: ToolCall[]) => {
      setToolCallsForDisplay((prevTrackedCalls) =>
        updatedCoreToolCalls.map((coreTc) => {
          const existingTrackedCall = prevTrackedCalls.find(
            (ptc) => ptc.request.callId === coreTc.request.callId,
          );
          const newTrackedCall: TrackedToolCall = {
            ...coreTc,
            responseSubmittedToGemini:
              existingTrackedCall?.responseSubmittedToGemini ?? false,
          } as TrackedToolCall;
          return newTrackedCall;
        }),
      );
    },
    [setToolCallsForDisplay],
  );

  const scheduler = useMemo(
    () =>
      new CoreToolScheduler({
        toolRegistry: config.getToolRegistry(),
        outputUpdateHandler,
        onAllToolCallsComplete: allToolCallsCompleteHandler,
        onToolCallsUpdate: toolCallsUpdateHandler,
        approvalMode: config.getApprovalMode(),
        getPreferredEditor,
        config,
      }),
    [
      config,
      outputUpdateHandler,
      allToolCallsCompleteHandler,
      toolCallsUpdateHandler,
      getPreferredEditor,
    ],
  );

  const schedule: ScheduleFn = useCallback(
    (
      request: ToolCallRequestInfo | ToolCallRequestInfo[],
      signal: AbortSignal,
    ) => {
      scheduler.schedule(request, signal).catch((error: unknown) => {
        // Prevent unhandled promise rejection. schedule() can throw if
        // called while other tools are still running, or if tool validation
        // fails. Without this catch, the error is silently swallowed and
        // tools can be left in 'validating' state indefinitely.
        console.error('[ToolScheduler] schedule() failed:', error);
      });
    },
    [scheduler],
  );

  const markToolsAsSubmitted: MarkToolsAsSubmittedFn = useCallback(
    (callIdsToMark: string[]) => {
      setToolCallsForDisplay((prevCalls) =>
        prevCalls.map((tc) =>
          callIdsToMark.includes(tc.request.callId)
            ? { ...tc, responseSubmittedToGemini: true }
            : tc,
        ),
      );
    },
    [],
  );

  return [toolCallsForDisplay, schedule, markToolsAsSubmitted];
}

/**
 * Maps a CoreToolScheduler status to the UI's ToolCallStatus enum.
 */
function mapCoreStatusToDisplayStatus(coreStatus: CoreStatus): ToolCallStatus {
  switch (coreStatus) {
    case 'validating':
      return ToolCallStatus.Executing;
    case 'awaiting_approval':
      return ToolCallStatus.Confirming;
    case 'executing':
      return ToolCallStatus.Executing;
    case 'success':
      return ToolCallStatus.Success;
    case 'cancelled':
      return ToolCallStatus.Canceled;
    case 'error':
      return ToolCallStatus.Error;
    case 'scheduled':
      return ToolCallStatus.Pending;
    default: {
      const exhaustiveCheck: never = coreStatus;
      console.warn(`Unknown core status encountered: ${exhaustiveCheck}`);
      return ToolCallStatus.Error;
    }
  }
}

/**
 * Generates a human-readable description from tool name and args
 * when the tool instance is not available.
 * This provides better UX than raw JSON.
 */
function generateFallbackDescription(
  toolName: string,
  args: Record<string, unknown>,
): string {
  // Special handling for common tools
  if (toolName === 'skills') {
    const action = args.action as string | undefined;
    const skillName = args.skill_name as string | undefined;
    const skillArgs = args.arguments as string | undefined;

    switch (action) {
      case 'list':
        return 'List available skills';
      case 'load':
        return skillName ? `Load skill "${skillName}"` : 'Load skill';
      case 'execute': {
        const argsStr = skillArgs ? ` ${skillArgs}` : '';
        return skillName ? `Execute skill "${skillName}"${argsStr}` : 'Execute skill';
      }
      default:
        return `Skills: ${action || 'unknown'}`;
    }
  }

  // Generic fallback: format key-value pairs nicely
  const parts: string[] = [];
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string') {
      parts.push(`${key}: "${value}"`);
    } else if (typeof value === 'object') {
      parts.push(`${key}: ${JSON.stringify(value)}`);
    } else {
      parts.push(`${key}: ${value}`);
    }
  }

  return parts.length > 0 ? `${toolName}(${parts.join(', ')})` : toolName;
}

/**
 * Transforms `TrackedToolCall` objects into `HistoryItemToolGroup` objects for UI display.
 */
const READ_ONLY_TOOL_NAMES = new Set([
  'read_file', 'read', 'glob', 'grep',
  'list_directory', 'ls', 'web_fetch', 'web_search',
]);

export function mapToDisplay(
  toolOrTools: TrackedToolCall[] | TrackedToolCall,
  collapsible?: boolean,
): HistoryItemToolGroup {
  const allToolCalls = Array.isArray(toolOrTools) ? toolOrTools : [toolOrTools];
  // Filter out write_todos as it has its own dedicated UI component
  const toolCalls = allToolCalls.filter(tc => tc.request.name !== 'write_todos');

  // Auto-collapse groups of 2+ read-only tools (unless explicitly set)
  if (collapsible === undefined && toolCalls.length >= 2) {
    collapsible = toolCalls.every(tc => READ_ONLY_TOOL_NAMES.has(tc.request.name));
  }

  const toolDisplays = toolCalls.map(
    (trackedCall): IndividualToolCallDisplay => {
      let displayName = trackedCall.request.name;
      let description = '';
      let renderOutputAsMarkdown = false;

      const currentToolInstance =
        'tool' in trackedCall && trackedCall.tool
          ? (trackedCall as { tool: Tool }).tool
          : undefined;

      if (currentToolInstance) {
        displayName = currentToolInstance.displayName;
        description = currentToolInstance.getDescription(
          trackedCall.request.args,
        );
        renderOutputAsMarkdown = currentToolInstance.isOutputMarkdown;
      } else if ('request' in trackedCall && 'args' in trackedCall.request) {
        // Fallback: Generate a human-readable description from tool name and args
        description = generateFallbackDescription(
          trackedCall.request.name,
          trackedCall.request.args,
        );
      }

      const baseDisplayProperties: Omit<
        IndividualToolCallDisplay,
        'status' | 'resultDisplay' | 'confirmationDetails'
      > = {
        callId: trackedCall.request.callId,
        name: displayName,
        description,
        renderOutputAsMarkdown,
      };

      switch (trackedCall.status) {
        case 'success':
          return {
            ...baseDisplayProperties,
            status: mapCoreStatusToDisplayStatus(trackedCall.status),
            resultDisplay: trackedCall.response.resultDisplay,
            confirmationDetails: undefined,
          };
        case 'error':
          return {
            ...baseDisplayProperties,
            name: currentToolInstance?.displayName ?? trackedCall.request.name,
            status: mapCoreStatusToDisplayStatus(trackedCall.status),
            resultDisplay: trackedCall.response.resultDisplay,
            confirmationDetails: undefined,
          };
        case 'cancelled':
          return {
            ...baseDisplayProperties,
            status: mapCoreStatusToDisplayStatus(trackedCall.status),
            resultDisplay: trackedCall.response.resultDisplay,
            confirmationDetails: undefined,
          };
        case 'awaiting_approval':
          return {
            ...baseDisplayProperties,
            status: mapCoreStatusToDisplayStatus(trackedCall.status),
            resultDisplay: undefined,
            confirmationDetails: trackedCall.confirmationDetails,
          };
        case 'executing':
          return {
            ...baseDisplayProperties,
            status: mapCoreStatusToDisplayStatus(trackedCall.status),
            resultDisplay:
              (trackedCall as TrackedExecutingToolCall).liveOutput ?? undefined,
            confirmationDetails: undefined,
          };
        case 'validating': // Fallthrough
        case 'scheduled':
          return {
            ...baseDisplayProperties,
            status: mapCoreStatusToDisplayStatus(trackedCall.status),
            resultDisplay: undefined,
            confirmationDetails: undefined,
          };
        default: {
          const exhaustiveCheck: never = trackedCall;
          return {
            callId: (exhaustiveCheck as TrackedToolCall).request.callId,
            name: 'Unknown Tool',
            description: 'Encountered an unknown tool call state.',
            status: ToolCallStatus.Error,
            resultDisplay: 'Unknown tool call state',
            confirmationDetails: undefined,
            renderOutputAsMarkdown: false,
          };
        }
      }
    },
  );

  return {
    type: 'tool_group',
    tools: toolDisplays,
    collapsible,
  };
}
