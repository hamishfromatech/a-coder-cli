/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Web Interface Module for a-coder-cli
 *
 * This module provides a browser-based interface for interacting with a-coder-cli.
 */

export { WebServer, startWebServer, stopWebServer, getWebServerStatus } from './server.js';
export { SSEManager, getSSEManager, resetSSEManager, type WebEvent, type WebEventType } from './sseManager.js';
export { getWebBridge, resetWebBridge, type WebMessage, type WebBridgeCallbacks } from './webBridge.js';