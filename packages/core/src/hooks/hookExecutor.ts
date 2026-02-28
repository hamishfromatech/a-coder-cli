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
 * Manages loading and executing hooks compatible with Claude Code's hook system.
 * This enables Dash to work with a-coder-cli.
 */
export class HookExecutor {
  private hooksSettings: HooksSettings | null = null;
  private settingsPath: string;
  private projectSettingsPath: string | null = null;
  private sessionId: string;
  private cwd: string;

  constructor(sessionId: string, cwd: string = process.cwd()) {
    this.sessionId = sessionId;
    this.cwd = cwd;
    this.settingsPath = path.join(os.homedir(), '.a-coder-cli', 'settings.json');
  }

  /**
   * Set the project-specific settings path
   */
  setProjectPath(projectPath: string): void {
    this.projectSettingsPath = path.join(projectPath, '.a-coder-cli', 'settings.json');
    this.reloadSettings();
  }

  /**
   * Reload settings from disk
   */
  reloadSettings(): void {
    this.hooksSettings = this.loadHooksSettings();
  }

  /**
   * Load hooks settings from settings files
   */
  private loadHooksSettings(): HooksSettings | null {
    const settings: HooksSettings = {};

    // Load global settings first
    try {
      if (fs.existsSync(this.settingsPath)) {
        const content = fs.readFileSync(this.settingsPath, 'utf-8');
        const parsed = JSON.parse(content);
        if (parsed.hooks && typeof parsed.hooks === 'object') {
          Object.assign(settings, parsed.hooks);
        }
      }
    } catch (error) {
      console.error('[HookExecutor] Failed to load global settings:', error);
    }

    // Load project settings (higher priority)
    if (this.projectSettingsPath) {
      try {
        if (fs.existsSync(this.projectSettingsPath)) {
          const content = fs.readFileSync(this.projectSettingsPath, 'utf-8');
          const parsed = JSON.parse(content);
          if (parsed.hooks && typeof parsed.hooks === 'object') {
            Object.assign(settings, parsed.hooks);
          }
        }
      } catch (error) {
        console.error('[HookExecutor] Failed to load project settings:', error);
      }
    }

    return Object.keys(settings).length > 0 ? settings : null;
  }

  /**
   * Get the transcript path for this session
   */
  private getTranscriptPath(): string {
    return path.join(os.homedir(), '.a-coder-cli', 'sessions', `${this.sessionId}.json`);
  }

  /**
   * Execute a hook command
   */
  private async executeCommand(command: string, context: HookContext): Promise<HookResult> {
    try {
      const env = {
        ...process.env,
        A_CODER_SESSION_ID: this.sessionId,
        A_CODER_CWD: this.cwd,
      };

      // For commands that read from stdin, pipe the context via stdin
      // Note: execAsync doesn't support input option, so we use spawn for stdin piping
      const { stdout, stderr } = await execAsync(command, {
        cwd: this.cwd,
        env,
        timeout: 30000, // 30 second timeout
        maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      });

      // Try to parse output as JSON for additional context
      let additionalContext: string | undefined;
      try {
        const parsed = JSON.parse(stdout.trim());
        if (parsed.additionalContext && typeof parsed.additionalContext === 'string') {
          additionalContext = parsed.additionalContext;
        }
      } catch {
        // Not JSON, treat as plain output
      }

      return {
        success: true,
        output: stdout || stderr,
        additionalContext,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMessage,
        output: '',
      };
    }
  }

  /**
   * Execute all hooks for a given event
   */
  async executeHooks(eventName: HookEventName, context: Partial<HookContext>): Promise<HookResult[]> {
    if (!this.hooksSettings) {
      this.reloadSettings();
    }

    if (!this.hooksSettings) {
      return [];
    }

    const hookConfigs = this.hooksSettings[eventName];
    if (!hookConfigs || hookConfigs.length === 0) {
      return [];
    }

    // Build the full context
    const fullContext: HookContext = {
      session_id: this.sessionId,
      transcript_path: this.getTranscriptPath(),
      cwd: this.cwd,
      hook_event_name: eventName,
      ...context,
    } as HookContext;

    const results: HookResult[] = [];

    for (const config of hookConfigs) {
      // Check matcher for Notification hooks
      if (eventName === 'Notification' && config.matcher) {
        const notifContext = fullContext as any;
        if (notifContext.notification_type !== config.matcher) {
          continue;
        }
      }

      // Check matcher for SessionStart hooks
      if (eventName === 'SessionStart' && config.matcher) {
        // SessionStart matcher is typically 'startup'
        if (config.matcher !== 'startup') {
          continue;
        }
      }

      for (const hook of config.hooks) {
        if (hook.type === 'command') {
          const result = await this.executeCommand(hook.command, fullContext);
          results.push(result);
        }
      }
    }

    return results;
  }

  /**
   * Execute Stop hooks (called when AI finishes responding)
   */
  async executeStopHooks(): Promise<HookResult[]> {
    return this.executeHooks('Stop', {});
  }

  /**
   * Execute UserPromptSubmit hooks (called when user submits a prompt)
   */
  async executeUserPromptSubmitHooks(prompt?: string): Promise<HookResult[]> {
    return this.executeHooks('UserPromptSubmit', { prompt });
  }

  /**
   * Execute Notification hooks
   */
  async executeNotificationHooks(
    notificationType: string,
    message: string,
    title?: string,
  ): Promise<HookResult[]> {
    return this.executeHooks('Notification', {
      notification_type: notificationType as any,
      message,
      title,
    });
  }

  /**
   * Execute SessionStart hooks
   */
  async executeSessionStartHooks(): Promise<HookResult[]> {
    return this.executeHooks('SessionStart', {});
  }

  /**
   * Check if any hooks are configured for an event
   */
  hasHooks(eventName: HookEventName): boolean {
    if (!this.hooksSettings) {
      this.reloadSettings();
    }

    if (!this.hooksSettings) {
      return false;
    }

    const hookConfigs = this.hooksSettings[eventName];
    return !!(hookConfigs && hookConfigs.length > 0);
  }

  /**
   * Get additional context from task-context.json if it exists (for Dash integration)
   */
  getTaskContext(): { additionalContext?: string; meta?: any } | null {
    const contextPath = path.join(this.cwd, '.a-coder-cli', 'task-context.json');
    try {
      if (fs.existsSync(contextPath)) {
        const content = fs.readFileSync(contextPath, 'utf-8');
        return JSON.parse(content);
      }
    } catch (error) {
      // Ignore errors
    }
    return null;
  }
}

/**
 * Global hook executor instance
 */
let globalHookExecutor: HookExecutor | null = null;

/**
 * Get or create the global hook executor
 */
export function getHookExecutor(sessionId: string, cwd?: string): HookExecutor {
  if (!globalHookExecutor) {
    globalHookExecutor = new HookExecutor(sessionId, cwd);
  }
  return globalHookExecutor;
}

/**
 * Reset the global hook executor (useful for testing)
 */
export function resetHookExecutor(): void {
  globalHookExecutor = null;
}