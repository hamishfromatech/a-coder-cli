/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useCallback } from 'react';
import { getWebBridge, getSSEManager } from '../../web/index.js';
import type { HistoryItem } from '../types.js';
import type { UseHistoryManagerReturn } from './useHistoryManager.js';

/**
 * Options for the useWebBridge hook
 */
export interface UseWebBridgeOptions {
  /** The submitQuery function from useGeminiStream */
  submitQuery: (query: string) => void | Promise<void>;
  /** The history manager's addItem function */
  addItem: UseHistoryManagerReturn['addItem'];
  /** The history array */
  history: HistoryItem[];
  /** The streaming state */
  streamingState: 'idle' | 'responding' | 'waiting_for_confirmation';
}

/**
 * Hook to integrate the web bridge with the CLI.
 *
 * This hook:
 * 1. Registers callbacks to receive messages from web clients
 * 2. Broadcasts history updates to connected web clients
 * 3. Broadcasts streaming state changes
 */
export function useWebBridge({
  submitQuery,
  addItem,
  history,
  streamingState,
}: UseWebBridgeOptions): void {
  const historyRef = useRef(history);
  const streamingStateRef = useRef(streamingState);

  // Keep refs in sync
  useEffect(() => {
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    streamingStateRef.current = streamingState;
  }, [streamingState]);

  // Handle incoming messages from web
  const handleMessageFromWeb = useCallback(
    (message: string) => {
      // Add user message to history
      addItem(
        { type: 'user', text: message },
        Date.now(),
      );

      // Submit to Gemini
      submitQuery(message);
    },
    [addItem, submitQuery],
  );

  // Set up the web bridge
  useEffect(() => {
    const bridge = getWebBridge();

    // Register callbacks
    bridge.setCallbacks({
      onMessageFromWeb: handleMessageFromWeb,
      getHistory: () => historyRef.current,
    });

    // Cleanup on unmount
    return () => {
      bridge.setCallbacks({});
    };
  }, [handleMessageFromWeb]);

  // Broadcast history changes to web clients
  useEffect(() => {
    const sseManager = getSSEManager();

    if (sseManager.hasClients()) {
      // Convert history to serializable format for web
      const serializedHistory = history.map((item) => {
        // Handle different history item types
        switch (item.type) {
          case 'user':
            return {
              type: 'user',
              text: item.text,
              timestamp: item.id,
            };
          case 'gemini':
          case 'gemini_content':
            return {
              type: 'gemini',
              text: item.text,
              timestamp: item.id,
            };
          case 'info':
            return {
              type: 'info',
              text: item.text,
              timestamp: item.id,
            };
          case 'error':
            return {
              type: 'error',
              text: item.text,
              timestamp: item.id,
            };
          case 'tool_group':
            return {
              type: 'tool_group',
              tools: item.tools,
              timestamp: item.id,
            };
          default:
            return {
              timestamp: item.id,
              ...item,
            };
        }
      });

      sseManager.broadcastHistory(serializedHistory);
    }
  }, [history]);

  // Broadcast streaming state changes
  useEffect(() => {
    const bridge = getWebBridge();

    if (bridge.hasWebClients()) {
      bridge.broadcastStatus(streamingState);
    }
  }, [streamingState]);
}