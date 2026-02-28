/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  type HookConfig,
  type HooksSettings,
  type HookContext,
  type HookResult,
  type HookEventName,
} from './types.js';

const execAsync = promisify(exec);

/**
 * Hook executor for Dash-compatible hooks.
 *
 * This module provides a hook system compatible with Claude Code's settings.local.json
 * format, allowing Dash to work with a-coder-cli.
 */
export class DashHookExecutor {
  private settingsDir: string;
  private hooks: HooksSettings | null = null;
  private sessionId: string;
  private cwd: string;

  constructor(sessionId: string, cwd: string = process.cwd()) {
    this.sessionId = sessionId;
    this.cwd = cwd;
    this.settingsDir = path.join(cwd, '.a-coder-cli');
  }

  /**
   * Load hooks from settings.local.json in the project directory.
   * Falls back to global settings in ~/.a-coder-cli/settings.json
   */
  async loadHooks(): Promise<void> {
    // Try project-level settings first
    const projectSettingsPath = path.join(this.settingsDir, 'settings.local.json');
    const globalSettingsPath = path.join(os.homedir(), '.a-coder-cli', 'settings.json');

    // Check for hooks in project settings.local.json (Dash writes here)
    if (fs.existsSync(projectSettingsPath)) {
      try {
        const content = fs.readFileSync(projectSettingsPath, 'utf-8');
        const parsed = JSON.parse(content);
        if (parsed.hooks) {
          this.hooks = parsed.hooks as HooksSettings;
          return;
        }
      } catch (error) {
        console.error('[HookExecutor] Failed to load project hooks:', error);
      }
    }

    // Fall back to global settings
    if (fs.existsSync(globalSettingsPath)) {
      try {
        const content = fs.readFileSync(globalSettingsPath, 'utf-8');
        const parsed = JSON.parse(content);
        if (parsed.hooks) {
          this.hooks = parsed.hooks as HooksSettings;
        }
      } catch (error) {
        console.error('[HookExecutor] Failed to load global hooks:', error);
      }
    }
  }

  /**
   * Set hooks directly (for programmatic configuration)
   */
  setHooks(hooks: HooksSettings): void {
    this.hooks = hooks;
  }

  /**
   * Write settings.local.json for Dash compatibility
   */
  writeDashSettings(port: number, ptyId: string, attribution?: string): void {
    const settingsPath = path.join(this.settingsDir, 'settings.local.json');

    // Build hooks that call back to Dash's hook server
    const curlBase = `curl -s --connect-timeout 2 http://127.0.0.1:${port}`;

    const hooks: HooksSettings = {
      Stop: [
        { hooks: [{ type: 'command', command: `${curlBase}/hook/stop?ptyId=${ptyId}` }] }
      ],
      UserPromptSubmit: [
        { hooks: [{ type: 'command', command: `${curlBase}/hook/busy?ptyId=${ptyId}` }] }
      ],
      Notification: [
        {
          matcher: 'permission_prompt',
          hooks: [
            {
              type: 'command',
              command: `curl -s --connect-timeout 2 -X POST -H "Content-Type: application/json" -d @- http://127.0.0.1:${port}/hook/notification?ptyId=${ptyId}`,
            },
          ],
        },
        {
          matcher: 'idle_prompt',
          hooks: [
            {
              type: 'command',
              command: `curl -s --connect-timeout 2 -X POST -H "Content-Type: application/json" -d @- http://127.0.0.1:${port}/hook/notification?ptyId=${ptyId}`,
            },
          ],
        },
      ],
    };

    // Check for task-context.json and add SessionStart hook if it exists
    const contextPath = path.join(this.settingsDir, 'task-context.json');
    if (fs.existsSync(contextPath)) {
      hooks.SessionStart = [
        {
          matcher: 'startup',
          hooks: [{ type: 'command', command: `cat "${contextPath}"` }],
        },
      ];
    }

    // Read existing settings to merge
    let existing: Record<string, unknown> = {};
    if (fs.existsSync(settingsPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      } catch {
        // Corrupted — overwrite
      }
    }

    const merged: Record<string, unknown> = {
      ...existing,
      hooks: {
        ...(existing.hooks && typeof existing.hooks === 'object' ? existing.hooks : {}),
        ...hooks,
      },
    };

    // Add attribution if provided
    if (attribution !== undefined) {
      merged.attribution = { commit: attribution };
    }

    // Ensure directory exists
    if (!fs.existsSync(this.settingsDir)) {
      fs.mkdirSync(this.settingsDir, { recursive: true });
    }

    fs.writeFileSync(settingsPath, JSON.stringify(merged, null, 2) + '\n');
    console.error(`[HookExecutor] Wrote ${settingsPath}`);
  }

  /**
   * Execute hooks for a given event
   */
  async executeHooks(
    eventName: HookEventName,
    context: HookContext,
    matcher?: string
  ): Promise<HookResult[]> {
    if (!this.hooks) {
      await this.loadHooks();
    }

    const hookConfigs = this.hooks?.[eventName];
    if (!hookConfigs || hookConfigs.length === 0) {
      return [];
    }

    const results: HookResult[] = [];

    for (const config of hookConfigs) {
      // Check matcher if provided
      if (config.matcher && matcher && config.matcher !== matcher) {
        continue;
      }

      for (const hook of config.hooks) {
        if (hook.type === 'command') {
          const result = await this.executeCommand(hook.command, context);
          results.push(result);
        }
      }
    }

    return results;
  }

  /**
   * Execute a hook command
   */
  private async executeCommand(
    command: string,
    context: HookContext
  ): Promise<HookResult> {
    try {
      // Set up environment with context
      const env: Record<string, string> = {
        ...process.env,
        A_CODER_SESSION_ID: context.session_id,
        A_CODER_CWD: context.cwd,
        A_CODER_HOOK_EVENT: context.hook_event_name,
      };

      // Add notification-specific env vars
      if (context.hook_event_name === 'Notification') {
        env.A_CODER_NOTIFICATION_TYPE = context.notification_type;
        env.A_CODER_MESSAGE = context.message;
        if (context.title) {
          env.A_CODER_TITLE = context.title;
        }
      }

      // Execute the command, piping context as JSON on stdin
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.cwd,
        env,
        timeout: 30000, // 30 second timeout
        maxBuffer: 1024 * 1024, // 1MB buffer
      });

      const output = stdout.trim() || stderr.trim();

      // Try to parse additionalContext from output
      let additionalContext: string | undefined;
      try {
        const parsed = JSON.parse(output);
        if (parsed.additionalContext) {
          additionalContext = parsed.additionalContext;
        }
      } catch {
        // Not JSON, use output as-is
      }

      return {
        success: true,
        output,
        additionalContext,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMessage,
        output: '',
      };
    }
  }

  /**
   * Convenience method to execute Stop hook
   */
  async onStop(): Promise<HookResult[]> {
    return this.executeHooks('Stop', {
      session_id: this.sessionId,
      transcript_path: this.getTranscriptPath(),
      cwd: this.cwd,
      hook_event_name: 'Stop',
    });
  }

  /**
   * Convenience method to execute UserPromptSubmit hook
   */
  async onUserPromptSubmit(prompt?: string): Promise<HookResult[]> {
    const context: HookContext = {
      session_id: this.sessionId,
      transcript_path: this.getTranscriptPath(),
      cwd: this.cwd,
      hook_event_name: 'UserPromptSubmit',
      prompt,
    };
    return this.executeHooks('UserPromptSubmit', context);
  }

  /**
   * Convenience method to execute Notification hook
   */
  async onNotification(
    type: 'permission_prompt' | 'idle_prompt' | 'auth_success' | 'elicitation_dialog',
    message: string,
    title?: string
  ): Promise<HookResult[]> {
    const context: HookContext = {
      session_id: this.sessionId,
      transcript_path: this.getTranscriptPath(),
      cwd: this.cwd,
      hook_event_name: 'Notification',
      notification_type: type,
      message,
      title,
    };
    return this.executeHooks('Notification', context, type);
  }

  /**
   * Convenience method to execute SessionStart hook
   */
  async onSessionStart(): Promise<HookResult[]> {
    return this.executeHooks('SessionStart', {
      session_id: this.sessionId,
      transcript_path: this.getTranscriptPath(),
      cwd: this.cwd,
      hook_event_name: 'SessionStart',
    });
  }

  /**
   * Get the transcript path for hook context
   */
  private getTranscriptPath(): string {
    return path.join(os.homedir(), '.a-coder-cli', 'sessions', `${this.sessionId}.json`);
  }
}

// Singleton instance for convenience
let hookExecutorInstance: DashHookExecutor | null = null;

/**
 * Initialize the global dash hook executor
 */
export function initDashHookExecutor(sessionId: string, cwd?: string): DashHookExecutor {
  hookExecutorInstance = new DashHookExecutor(sessionId, cwd);
  return hookExecutorInstance;
}

/**
 * Get the global dash hook executor
 */
export function getDashHookExecutor(): DashHookExecutor | null {
  return hookExecutorInstance;
}