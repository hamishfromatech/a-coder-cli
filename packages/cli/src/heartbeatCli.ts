/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config, AuthType } from '@a-coder/core';
import { loadCliConfig, parseArguments, CliArgs } from './config/config.js';
import { loadExtensions } from './config/extension.js';
import { loadSettings } from './config/settings.js';
import { sessionId } from '@a-coder/core';
import { HeartbeatManager } from '@a-coder/core';
import * as fs from 'fs';
import { getHeartbeatPath } from '@a-coder/core';

/**
 * Heartbeat mode entry point.
 * Runs a-coder-cli in a scheduled background mode.
 */
export async function runHeartbeatMode(): Promise<void> {
  const workspaceRoot = process.cwd();
  const settings = loadSettings(workspaceRoot);

  if (settings.errors.length > 0) {
    console.error('Settings errors:', settings.errors);
    process.exit(1);
  }

  const argv = await parseArguments();
  const extensions = loadExtensions(workspaceRoot);

  // Determine interval: CLI arg > heartbeat.md > default (10 min)
  const heartbeatPath = getHeartbeatPath(workspaceRoot);
  let intervalMinutes = 10;

  if (argv.heartbeatInterval !== undefined) {
    intervalMinutes = argv.heartbeatInterval;
  } else if (fs.existsSync(heartbeatPath)) {
    const content = fs.readFileSync(heartbeatPath, 'utf8');
    const match = content.match(/^Interval:\s*(\d+)/m);
    if (match) {
      intervalMinutes = parseInt(match[1], 10);
    }
  }

  console.log(`[Heartbeat] Using ${intervalMinutes} minute interval.`);

  // Create config for heartbeat mode with YOLO mode
  const config = await loadCliConfig(
    settings.merged,
    extensions,
    sessionId,
    {
      ...argv,
      yolo: true, // Force YOLO mode for heartbeat
    } as CliArgs,
  );

  await config.initialize();

  // Set auth for non-interactive mode
  await config.refreshAuth(AuthType.USE_OPENAI);

  // Create and start heartbeat manager
  const heartbeatManager = new HeartbeatManager(config, {
    intervalMinutes,
  });

  const started = heartbeatManager.start();
  if (!started) {
    console.error('Failed to start heartbeat mode. Is another instance running?');
    process.exit(1);
  }

  // Keep the process running
  console.log('[Heartbeat] Press Ctrl+C to stop.');
}
