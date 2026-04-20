/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import { Config } from '../config/config.js';
import {
  BaseTool,
  ToolResult,
} from './tools.js';
import { Type } from '@google/genai';
import { GEMINI_DIR } from '../utils/paths.js';
import { getHeartbeatPath } from '../core/heartbeatManager.js';

/**
 * Parameters for the ExitHeartbeat tool
 */
export interface ExitHeartbeatToolParams {
  /**
   * Optional reason for exiting the heartbeat cycle
   */
  reason?: string;
}

/**
 * Tool that the CLI agent calls when it determines its work for the current
 * heartbeat cycle is complete. Updates heartbeat.md status and exits the process
 * so the scheduler can sleep until the next interval.
 */
export class ExitHeartbeatTool extends BaseTool<ExitHeartbeatToolParams, ToolResult> {
  static readonly Name: string = 'exit_heartbeat';

  constructor(private readonly config: Config) {
    super(
      ExitHeartbeatTool.Name,
      'ExitHeartbeat',
      `Exit the current heartbeat cycle. Call this tool when you have completed your work
      for this cycle and are ready to return to the heartbeat scheduler.
      The scheduler will wake up again at the next interval.
      Optionally provide a reason describing what was accomplished.`,
      {
        properties: {
          reason: {
            description: 'Optional reason for exiting the heartbeat cycle (e.g. what was accomplished)',
            type: Type.STRING,
          },
        },
        type: Type.OBJECT,
      },
    );
  }

  validateToolParams(_params: ExitHeartbeatToolParams): string | null {
    // No required params, reason is optional
    return null;
  }

  override getVerbPhrase(_params: ExitHeartbeatToolParams): string {
    return 'Stopping heartbeat...';
  }

  async execute(
    params: ExitHeartbeatToolParams,
    _signal: AbortSignal,
  ): Promise<ToolResult> {
    const heartbeatPath = getHeartbeatPath(this.config.getTargetDir());

    // Update heartbeat.md status
    if (fs.existsSync(heartbeatPath)) {
      let content = fs.readFileSync(heartbeatPath, 'utf8');
      const now = new Date().toISOString();

      content = content.replace(/Last Run:.*/g, `Last Run: ${now}`);
      content = content.replace(/^Status:.*/gm, 'Status: idle');

      if (params.reason) {
        content = content.replace(
          /^Current Task:.*/gm,
          `Current Task: ${params.reason}`,
        );
      } else {
        content = content.replace(/^Current Task:.*/gm, 'Current Task: null');
      }

      fs.writeFileSync(heartbeatPath, content, 'utf8');
    }

    // Exit the process after a short delay to allow the response to be sent
    setTimeout(() => {
      process.exit(0);
    }, 500);

    const reasonMsg = params.reason ? ` Reason: ${params.reason}` : '';
    return {
      llmContent: `Heartbeat cycle complete.${reasonMsg} Exiting to return control to the heartbeat scheduler.`,
      returnDisplay: `Exiting heartbeat cycle.${reasonMsg}`,
    };
  }
}
