/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { getSSEManager, type WebEvent } from './sseManager.js';
import type { HistoryItem } from '../ui/types.js';

/**
 * Message submitted from web client
 */
export interface WebMessage {
  id: string;
  text: string;
  timestamp: number;
}

/**
 * Callback types for CLI integration
 */
export interface WebBridgeCallbacks {
  /** Called when a message is submitted from web */
  onMessageFromWeb?: (message: string) => void;
  /** Called to get current history */
  getHistory?: () => HistoryItem[];
}

/**
 * Bridge between the CLI and web clients.
 *
 * This singleton acts as the interface between:
 * 1. The web server (which receives HTTP requests from browsers)
 * 2. The CLI (which processes messages and manages history)
 *
 * Usage:
 * 1. CLI calls `setCallbacks()` to register handlers
 * 2. Web server calls `submitMessage()` to queue messages
 * 3. CLI calls `processPendingMessages()` to handle queued messages
 * 4. CLI calls `broadcastHistory()` to send updates to web clients
 */
class WebBridge {
  private messageQueue: WebMessage[] = [];
  private callbacks: WebBridgeCallbacks = {};
  private messageIdCounter = 0;

  /**
   * Register callbacks from the CLI.
   * This should be called once when the CLI starts.
   */
  setCallbacks(callbacks: WebBridgeCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Submit a message from the web interface.
   * Queues the message for processing by the CLI.
   */
  submitMessage(text: string): string {
    const id = `web-msg-${++this.messageIdCounter}-${Date.now()}`;
    const message: WebMessage = {
      id,
      text,
      timestamp: Date.now(),
    };
    this.messageQueue.push(message);

    // If callback is registered, call it immediately
    if (this.callbacks.onMessageFromWeb) {
      // Process synchronously if possible
      this.callbacks.onMessageFromWeb(text);
    }

    return id;
  }

  /**
   * Get all pending messages from the queue.
   * Returns messages and clears the queue.
   */
  getPendingMessages(): WebMessage[] {
    const messages = [...this.messageQueue];
    this.messageQueue = [];
    return messages;
  }

  /**
   * Check if there are pending messages.
   */
  hasPendingMessages(): boolean {
    return this.messageQueue.length > 0;
  }

  /**
   * Get current history from the CLI and broadcast to web clients.
   */
  broadcastHistory(): void {
    if (this.callbacks.getHistory) {
      const history = this.callbacks.getHistory();
      const sseManager = getSSEManager();
      sseManager.broadcastHistory(history);
    }
  }

  /**
   * Broadcast a single history item update.
   */
  broadcastHistoryItem(item: HistoryItem): void {
    const sseManager = getSSEManager();
    const content = 'text' in item && item.text ? item.text : JSON.stringify(item);
    const event: WebEvent = {
      type: item.type as WebEvent['type'],
      content,
      timestamp: item.id,
      id: String(item.id),
      metadata: { ...item },
    };
    sseManager.broadcast(event);
  }

  /**
   * Broadcast a status update to web clients.
   */
  broadcastStatus(status: 'idle' | 'responding' | 'waiting_for_confirmation'): void {
    const sseManager = getSSEManager();
    sseManager.broadcast({
      type: 'info',
      content: JSON.stringify({ status, timestamp: Date.now() }),
      timestamp: Date.now(),
    });
  }

  /**
   * Check if any web clients are connected.
   */
  hasWebClients(): boolean {
    return getSSEManager().hasClients();
  }
}

// Singleton instance
let webBridgeInstance: WebBridge | null = null;

/**
 * Get the singleton WebBridge instance.
 */
export function getWebBridge(): WebBridge {
  if (!webBridgeInstance) {
    webBridgeInstance = new WebBridge();
  }
  return webBridgeInstance;
}

/**
 * Reset the WebBridge (for testing).
 */
export function resetWebBridge(): void {
  if (webBridgeInstance) {
    webBridgeInstance = null;
  }
}