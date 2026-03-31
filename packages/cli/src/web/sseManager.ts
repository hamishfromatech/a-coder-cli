/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Server as HttpServer } from 'http';
import type { Response } from 'express';

/**
 * Event types that can be sent to web clients
 */
export type WebEventType =
  | 'user'
  | 'gemini'
  | 'gemini_content'
  | 'tool_group'
  | 'info'
  | 'error'
  | 'thought'
  | 'compression'
  | 'connected'
  | 'history';

/**
 * Event data sent to web clients via SSE
 */
export interface WebEvent {
  type: WebEventType;
  content: string;
  timestamp: number;
  id?: string;
  metadata?: Record<string, unknown>;
}

/**
 * SSE client connection
 */
interface SSEClient {
  id: string;
  res: Response;
  connected: boolean;
}

/**
 * Singleton class that manages Server-Sent Events connections
 * and broadcasts history updates to connected web clients.
 */
export class SSEManager {
  private clients: Map<string, SSEClient> = new Map();
  private clientIdCounter = 0;

  /**
   * Add a new SSE client connection
   */
  addClient(res: Response): string {
    const id = `client-${++this.clientIdCounter}`;

    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();

    const client: SSEClient = {
      id,
      res,
      connected: true,
    };

    this.clients.set(id, client);

    // Send connected event
    this.sendToClient(id, {
      type: 'connected',
      content: JSON.stringify({ message: 'Connected to a-coder-cli', clientId: id }),
      timestamp: Date.now(),
    });

    // Handle client disconnect
    res.on('close', () => {
      client.connected = false;
      this.clients.delete(id);
    });

    return id;
  }

  /**
   * Remove an SSE client connection
   */
  removeClient(id: string): void {
    const client = this.clients.get(id);
    if (client) {
      client.connected = false;
      this.clients.delete(id);
    }
  }

  /**
   * Send an event to a specific client
   */
  private sendToClient(id: string, event: WebEvent): void {
    const client = this.clients.get(id);
    if (client && client.connected) {
      try {
        client.res.write(`data: ${JSON.stringify(event)}\n\n`);
      } catch {
        // Client disconnected, will be cleaned up by close handler
      }
    }
  }

  /**
   * Broadcast an event to all connected clients
   */
  broadcast(event: WebEvent): void {
    const data = `data: ${JSON.stringify(event)}\n\n`;
    for (const [id, client] of this.clients) {
      if (client.connected) {
        try {
          client.res.write(data);
        } catch {
          // Client disconnected
          client.connected = false;
          this.clients.delete(id);
        }
      }
    }
  }

  /**
   * Broadcast history to all connected clients
   */
  broadcastHistory(history: unknown[]): void {
    this.broadcast({
      type: 'history',
      content: JSON.stringify(history),
      timestamp: Date.now(),
    });
  }

  /**
   * Get the number of connected clients
   */
  getClientCount(): number {
    return this.clients.size;
  }

  /**
   * Check if there are any connected clients
   */
  hasClients(): boolean {
    return this.clients.size > 0;
  }

  /**
   * Close all client connections
   */
  closeAll(): void {
    for (const [id, client] of this.clients) {
      try {
        client.res.end();
      } catch {
        // Ignore errors during cleanup
      }
    }
    this.clients.clear();
  }
}

// Singleton instance
let sseManagerInstance: SSEManager | null = null;

/**
 * Get the singleton SSEManager instance
 */
export function getSSEManager(): SSEManager {
  if (!sseManagerInstance) {
    sseManagerInstance = new SSEManager();
  }
  return sseManagerInstance;
}

/**
 * Reset the SSEManager (for testing)
 */
export function resetSSEManager(): void {
  if (sseManagerInstance) {
    sseManagerInstance.closeAll();
    sseManagerInstance = null;
  }
}