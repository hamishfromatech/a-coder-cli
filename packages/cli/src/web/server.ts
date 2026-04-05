/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import express, { Express, Request, Response } from 'express';
import { createServer, Server as HttpServer } from 'http';
import * as path from 'path';
import * as fs from 'fs';
import { fileURLToPath } from 'url';
import { getSSEManager } from './sseManager.js';
import { getWebBridge } from './webBridge.js';

// Get __dirname equivalent in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Web server for a-coder-cli browser interface.
 */
export class WebServer {
  private app: Express;
  private server: HttpServer | null = null;
  private port: number;
  private static instance: WebServer | null = null;

  constructor(port: number = 3456) {
    this.port = port;
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * Get singleton instance of WebServer.
   */
  static getInstance(port?: number): WebServer {
    if (!WebServer.instance) {
      WebServer.instance = new WebServer(port);
    }
    return WebServer.instance;
  }

  /**
   * Setup Express middleware.
   */
  private setupMiddleware(): void {
    this.app.use(express.json());
    this.app.use(express.urlencoded({ extended: true }));

    // CORS for local development
    this.app.use((req: Request, res: Response, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      if (req.method === 'OPTIONS') {
        res.sendStatus(200);
        return;
      }
      next();
    });
  }

  /**
   * Setup API routes and static file serving.
   */
  private setupRoutes(): void {
    // SSE endpoint for real-time updates
    this.app.get('/api/events', this.handleSSE.bind(this));

    // Get current history
    this.app.get('/api/history', this.handleGetHistory.bind(this));

    // Send a message from web
    this.app.post('/api/send', this.handleSendMessage.bind(this));

    // Get server status
    this.app.get('/api/status', this.handleStatus.bind(this));

    // Serve static files
    this.app.use(express.static(this.getPublicDir()));

    // Fallback to index.html for SPA routing
    this.app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(this.getPublicDir(), 'index.html'));
    });
  }

  /**
   * Get the directory containing static files.
   */
  private getPublicDir(): string {
    // Try multiple locations where public assets may live:
    // 1. src/web/public (when running from dist/src/web/)
    const devPath = path.join(__dirname, 'public');
    // 2. dist/web/public (alternative dist layout)
    const distPath = path.join(__dirname, '..', 'web', 'public');
    // 3. bundle/web/public (when running from the esbuild bundle)
    const bundlePath = path.join(__dirname, 'web', 'public');
    // 4. Same directory as the running entry point (when installed globally)
    const entryDir = path.join(path.dirname(process.argv[1]), 'web', 'public');

    for (const candidate of [devPath, distPath, bundlePath, entryDir]) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    // Fallback: return the most likely path for the current context
    return devPath;
  }

  /**
   * Handle SSE connections.
   */
  private handleSSE(req: Request, res: Response): void {
    const sseManager = getSSEManager();
    const clientId = sseManager.addClient(res);

    // Send initial connection message
    sseManager.broadcast({
      type: 'connected',
      content: JSON.stringify({
        message: 'Connected to a-coder-cli',
        clientId,
      }),
      timestamp: Date.now(),
    });

    // Keep connection alive
    req.on('close', () => {
      sseManager.removeClient(clientId);
    });
  }

  /**
   * Handle GET /api/history - return current conversation history.
   */
  private handleGetHistory(req: Request, res: Response): void {
    const bridge = getWebBridge();
    // History is managed by the CLI, so we need to broadcast a request
    // and return the current state
    res.json({
      success: true,
      history: [],
      message: 'History will be streamed via SSE',
    });
  }

  /**
   * Handle POST /api/send - receive message from web client.
   */
  private handleSendMessage(req: Request, res: Response): void {
    const { message } = req.body;

    if (!message || typeof message !== 'string') {
      res.status(400).json({
        success: false,
        error: 'Message is required and must be a string',
      });
      return;
    }

    const bridge = getWebBridge();
    const messageId = bridge.submitMessage(message);

    res.json({
      success: true,
      messageId,
      message: 'Message queued for processing',
    });
  }

  /**
   * Handle GET /api/status - return server status.
   */
  private handleStatus(req: Request, res: Response): void {
    const sseManager = getSSEManager();
    res.json({
      success: true,
      status: 'running',
      port: this.port,
      clientsConnected: sseManager.getClientCount(),
    });
  }

  /**
   * Start the web server.
   */
  async start(): Promise<{ success: boolean; port: number; message: string }> {
    if (this.server) {
      return {
        success: false,
        port: this.port,
        message: 'Server is already running',
      };
    }

    return new Promise((resolve) => {
      this.server = createServer(this.app);

      this.server.listen(this.port, () => {
        resolve({
          success: true,
          port: this.port,
          message: `Web server started at http://localhost:${this.port}`,
        });
      });

      this.server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          resolve({
            success: false,
            port: this.port,
            message: `Port ${this.port} is already in use`,
          });
        } else {
          resolve({
            success: false,
            port: this.port,
            message: `Failed to start server: ${err.message}`,
          });
        }
      });
    });
  }

  /**
   * Stop the web server.
   */
  async stop(): Promise<{ success: boolean; message: string }> {
    if (!this.server) {
      return {
        success: false,
        message: 'Server is not running',
      };
    }

    return new Promise((resolve) => {
      const sseManager = getSSEManager();
      sseManager.closeAll();

      this.server!.close((err) => {
        if (err) {
          resolve({
            success: false,
            message: `Error stopping server: ${err.message}`,
          });
        } else {
          this.server = null;
          WebServer.instance = null;
          resolve({
            success: true,
            message: 'Web server stopped',
          });
        }
      });
    });
  }

  /**
   * Check if server is running.
   */
  isRunning(): boolean {
    return this.server !== null && this.server.listening;
  }

  /**
   * Get current port.
   */
  getPort(): number {
    return this.port;
  }
}

/**
 * Create and start a web server.
 */
export async function startWebServer(port?: number): Promise<{ success: boolean; port: number; message: string }> {
  const server = WebServer.getInstance(port);
  return server.start();
}

/**
 * Stop the web server.
 */
export async function stopWebServer(): Promise<{ success: boolean; message: string }> {
  const server = WebServer.getInstance();
  return server.stop();
}

/**
 * Get web server status.
 */
export function getWebServerStatus(): { running: boolean; port?: number; clients: number } {
  const sseManager = getSSEManager();
  const server = WebServer.getInstance();
  return {
    running: server.isRunning(),
    port: server.isRunning() ? server.getPort() : undefined,
    clients: sseManager.getClientCount(),
  };
}