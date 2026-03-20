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
  type PreToolUseHookContext,
  type PreToolUseHookResult,
  type PromptHook,
} from './types.js';

const execAsync = promisify(exec);

/**
 * Type for LLM call function used by prompt hooks
 */
export type LLMCallFunction = (prompt: string) => Promise<string>;

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
  private llmCallFunction: LLMCallFunction | null = null;

  constructor(sessionId: string, cwd: string = process.cwd()) {
    this.sessionId = sessionId;
    this.cwd = cwd;
    this.settingsPath = path.join(os.homedir(), '.a-coder-cli', 'settings.json');
  }

  /**
   * Set the LLM call function for prompt hooks
   */
  setLLMCallFunction(fn: LLMCallFunction | null): void {
    this.llmCallFunction = fn;
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

      // Try to parse output as JSON for additional context and structured results
      let additionalContext: string | undefined;
      let permissionDecision: 'allow' | 'deny' | 'ask' | undefined;
      let updatedInput: Record<string, unknown> | undefined;
      let systemMessage: string | undefined;

      try {
        const parsed = JSON.parse(stdout.trim());
        if (parsed.additionalContext && typeof parsed.additionalContext === 'string') {
          additionalContext = parsed.additionalContext;
        }
        if (parsed.permissionDecision && ['allow', 'deny', 'ask'].includes(parsed.permissionDecision)) {
          permissionDecision = parsed.permissionDecision;
        }
        if (parsed.updatedInput && typeof parsed.updatedInput === 'object') {
          updatedInput = parsed.updatedInput;
        }
        if (parsed.systemMessage && typeof parsed.systemMessage === 'string') {
          systemMessage = parsed.systemMessage;
        }
      } catch {
        // Not JSON, treat as plain output
      }

      return {
        success: true,
        output: stdout || stderr,
        additionalContext,
        permissionDecision,
        updatedInput,
        systemMessage,
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
   * Execute a prompt-based hook using LLM
   */
  private async executePromptHook(
    hook: PromptHook,
    context: HookContext,
  ): Promise<HookResult> {
    if (!this.llmCallFunction) {
      return {
        success: false,
        error: 'LLM call function not configured for prompt hooks',
        permissionDecision: 'ask', // Default to ask on error
      };
    }

    try {
      // Build the prompt with context
      let contextStr = '';
      if (context.hook_event_name === 'PreToolUse') {
        const preToolContext = context as PreToolUseHookContext;
        contextStr = `- Tool: ${preToolContext.tool_name}
- Arguments: ${JSON.stringify(preToolContext.tool_input, null, 2)}
- Working Directory: ${preToolContext.cwd}`;
      } else {
        contextStr = `- Event: ${context.hook_event_name}
- Working Directory: ${(context as any).cwd}`;
      }

      const fullPrompt = `${hook.prompt}

Context:
${contextStr}

Return JSON with your decision:
{
  "decision": "allow" | "deny" | "ask",
  "reason": "explanation for the decision",
  "updatedInput": { ... } // optional, only for PreToolUse to modify tool arguments
}`;

      const timeout = hook.timeout ?? 30000;
      const responsePromise = this.llmCallFunction(fullPrompt);

      // Apply timeout
      const response = await Promise.race([
        responsePromise,
        new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('Prompt hook timed out')), timeout),
        ),
      ]);

      // Parse response
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          const decision = ['allow', 'deny', 'ask'].includes(parsed.decision)
            ? parsed.decision
            : 'ask';
          return {
            success: true,
            output: response,
            permissionDecision: decision,
            systemMessage: parsed.reason,
            updatedInput: parsed.updatedInput,
          };
        } catch {
          // JSON parse failed, default to ask
          return {
            success: true,
            output: response,
            permissionDecision: 'ask',
            systemMessage: 'Could not parse LLM response as JSON',
          };
        }
      }

      // No JSON found, default to allow
      return {
        success: true,
        output: response,
        permissionDecision: 'allow',
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        success: false,
        error: errorMessage,
        permissionDecision: 'ask', // Default to ask on error
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

      // Check matcher for PreToolUse hooks - matches tool name
      if (eventName === 'PreToolUse' && config.matcher) {
        const toolContext = fullContext as PreToolUseHookContext;
        if (!this.matchesToolPattern(toolContext.tool_name, toolContext.tool_input, config.matcher)) {
          continue;
        }
      }

      for (const hook of config.hooks) {
        if (hook.type === 'command') {
          const result = await this.executeCommand(hook.command, fullContext);
          results.push(result);
        } else if (hook.type === 'prompt') {
          // LLM-based prompt hook
          const result = await this.executePromptHook(hook, fullContext);
          results.push(result);
        }
      }
    }

    return results;
  }

  /**
   * Check if a tool name and input match a pattern
   * Supports patterns like: ToolName, ToolName(arg1), ToolName(arg1, arg2), ToolName(*)
   */
  private matchesToolPattern(
    toolName: string,
    toolInput: Record<string, unknown>,
    pattern: string,
  ): boolean {
    // Exact tool name match
    if (pattern === toolName) {
      return true;
    }

    // Pattern with arguments: ToolName(arg1) or ToolName(*)
    const patternMatch = pattern.match(/^(\w+)\((.*)\)$/);
    if (patternMatch) {
      const [, patternToolName, patternArgs] = patternMatch;
      if (patternToolName !== toolName) {
        return false;
      }

      // Wildcard matches all args
      if (patternArgs === '*') {
        return true;
      }

      // Parse and match arguments
      const patternArgList = this.parsePatternArgs(patternArgs);
      const toolArgValues = this.extractToolArgValues(toolInput);

      // Check if all pattern args are present in tool args
      return patternArgList.every((pa) =>
        toolArgValues.some((ta) => ta.includes(pa) || ta === pa),
      );
    }

    // Regex pattern for advanced matching
    try {
      const regex = new RegExp(pattern);
      return regex.test(toolName);
    } catch {
      return false;
    }
  }

  /**
   * Parse pattern arguments string into array
   */
  private parsePatternArgs(argsString: string): string[] {
    const args: string[] = [];
    let current = '';
    let inQuotes = false;

    for (const char of argsString) {
      if (char === '"' || char === "'") {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        if (current.trim()) {
          args.push(current.trim());
        }
        current = '';
      } else {
        current += char;
      }
    }
    if (current.trim()) {
      args.push(current.trim());
    }

    return args;
  }

  /**
   * Extract string values from tool input for pattern matching
   */
  private extractToolArgValues(args: Record<string, unknown>): string[] {
    const values: string[] = [];
    for (const value of Object.values(args)) {
      if (typeof value === 'string') {
        values.push(value);
      } else if (Array.isArray(value)) {
        values.push(...value.filter((v): v is string => typeof v === 'string'));
      }
    }
    return values;
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
   * Execute SubagentStart hooks (called when a subagent is spawned)
   */
  async executeSubagentStartHooks(
    agentId: string,
    agentType: string,
    task: string,
    allowDestructive?: boolean,
    isolation?: string,
  ): Promise<HookResult[]> {
    return this.executeHooks('SubagentStart', {
      agent_id: agentId,
      agent_type: agentType,
      task,
      allow_destructive: allowDestructive,
      isolation,
    });
  }

  /**
   * Execute PreToolUse hooks (called before a tool is executed)
   * These hooks can allow, deny, or ask for user confirmation
   * They can also modify the tool input
   */
  async executePreToolUseHooks(
    toolName: string,
    toolInput: Record<string, unknown>,
  ): Promise<PreToolUseHookResult[]> {
    const results = await this.executeHooks('PreToolUse', {
      tool_name: toolName,
      tool_input: toolInput,
    } as PreToolUseHookContext);

    return results.map((result) => ({
      ...result,
      permissionDecision: result.permissionDecision,
      updatedInput: result.updatedInput,
      systemMessage: result.systemMessage,
    }));
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