/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SlashCommand, SlashCommandActionReturn, type CommandContext, CommandCategory } from './types.js';
import { MessageType } from '../types.js';
import {
  startWebServer,
  stopWebServer,
  getWebServerStatus,
} from '../../web/server.js';
import { getSSEManager } from '../../web/sseManager.js';

/**
 * Web server management command for a-coder-cli.
 *
 * Provides a browser-based interface to interact with the CLI.
 */
export const webCommand: SlashCommand = {
  name: 'web',
  description: 'Start a web interface for a-coder-cli',
  category: 'advanced' as CommandCategory,
  keywords: ['browser', 'ui', 'interface', 'web'],
  argumentHint: '[port]',
  examples: ['/web start', '/web start 8080', '/web stop', '/web status'],
  subCommands: [
    {
      name: 'start',
      description: 'Start the web server (default port: 3456)',
      argumentHint: '[port]',
      action: async (
        context: CommandContext,
        args: string,
      ): Promise<SlashCommandActionReturn> => {
        const portArg = args.trim().split(/\s+/)[0];
        const port = portArg ? parseInt(portArg, 10) : 3456;

        if (isNaN(port) || port < 1 || port > 65535) {
          return {
            type: 'message',
            messageType: 'error',
            content: `Invalid port number: ${portArg}. Please provide a number between 1 and 65535.`,
          };
        }

        const result = await startWebServer(port);

        if (result.success) {
          context.ui.addItem(
            {
              type: MessageType.INFO,
              text: `Web server started at http://localhost:${port}
Open this URL in your browser to chat with a-coder-cli.`,
            },
            Date.now(),
          );

          return {
            type: 'message',
            messageType: 'info',
            content: `🌐 Web server running at http://localhost:${port}

Features:
• Real-time chat interface with SSE streaming
• View conversation history
• Send messages from the browser

Commands:
• /web stop - Stop the server
• /web status - Check server status
• /web open - Open in browser`,
          };
        } else {
          return {
            type: 'message',
            messageType: 'error',
            content: result.message,
          };
        }
      },
    },
    {
      name: 'stop',
      description: 'Stop the web server',
      action: async (
        context: CommandContext,
        _args: string,
      ): Promise<SlashCommandActionReturn> => {
        const result = await stopWebServer();

        if (result.success) {
          return {
            type: 'message',
            messageType: 'info',
            content: 'Web server stopped.',
          };
        } else {
          return {
            type: 'message',
            messageType: 'error',
            content: result.message,
          };
        }
      },
    },
    {
      name: 'status',
      description: 'Check web server status',
      action: async (
        _context: CommandContext,
        _args: string,
      ): Promise<SlashCommandActionReturn> => {
        const status = getWebServerStatus();

        if (status.running) {
          return {
            type: 'message',
            messageType: 'info',
            content: `Web server status:
• Running: Yes
• Port: ${status.port}
• Connected clients: ${status.clients}`,
          };
        } else {
          return {
            type: 'message',
            messageType: 'info',
            content: `Web server status:
• Running: No

Start the server with: /web start [port]`,
          };
        }
      },
    },
    {
      name: 'open',
      description: 'Open the web interface in your browser',
      action: async (
        context: CommandContext,
        _args: string,
      ): Promise<SlashCommandActionReturn> => {
        const status = getWebServerStatus();

        if (!status.running) {
          return {
            type: 'message',
            messageType: 'error',
            content: 'Web server is not running. Start it first with: /web start',
          };
        }

        const url = `http://localhost:${status.port}`;

        try {
          const { default: open } = await import('open');
          await open(url);

          context.ui.addItem(
            {
              type: MessageType.INFO,
              text: `Opening ${url} in your browser...`,
            },
            Date.now(),
          );

          return {
            type: 'message',
            messageType: 'info',
            content: `Opening ${url} in your browser.`,
          };
        } catch (error) {
          return {
            type: 'message',
            messageType: 'error',
            content: `Could not open browser. Please open ${url} manually.`,
          };
        }
      },
    },
  ],
  // Default action when no subcommand provided
  action: async (
    _context: CommandContext,
    args: string,
  ): Promise<SlashCommandActionReturn> => {
    const status = getWebServerStatus();

    if (status.running) {
      return {
        type: 'message',
        messageType: 'info',
        content: `Web server is running on port ${status.port}.

Commands:
• /web stop - Stop the server
• /web status - Check server status
• /web open - Open in browser`,
      };
    }

    // If port is provided, start with that port
    const portArg = args.trim();
    if (portArg) {
      const port = parseInt(portArg, 10);
      if (!isNaN(port) && port >= 1 && port <= 65535) {
        const result = await startWebServer(port);
        if (result.success) {
          return {
            type: 'message',
            messageType: 'info',
            content: `Web server started at http://localhost:${port}`,
          };
        }
        return {
          type: 'message',
          messageType: 'error',
          content: result.message,
        };
      }
    }

    return {
      type: 'message',
      messageType: 'info',
      content: `Web Interface for a-coder-cli

Start a browser-based chat interface for a-coder-cli.

Usage:
  /web start [port]  - Start the web server (default port: 3456)
  /web stop           - Stop the web server
  /web status         - Check server status
  /web open           - Open in browser

Examples:
  /web start          - Start on default port 3456
  /web start 8080     - Start on port 8080
  /web stop           - Stop the server

Once started, open http://localhost:3456 in your browser.`,
    };
  },
};