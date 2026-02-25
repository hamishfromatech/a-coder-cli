/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import fs from 'fs';
import { Skill, SkillHooks } from './types.js';

const execAsync = promisify(exec);

/**
 * Hook execution result
 */
export interface HookResult {
  /** Whether the hook executed successfully */
  success: boolean;

  /** The hook's stdout output */
  output: string;

  /** Error message if the hook failed */
  error?: string;

  /** Exit code of the hook script */
  exitCode?: number;
}

/**
 * Hook executor for skill lifecycle scripts
 *
 * Hook scripts are located in the skill's scripts/ directory
 * and are executed via the shell.
 */
export class SkillHookExecutor {
  /**
   * Execute a skill hook
   *
   * @param skill - The skill whose hook to execute
   * @param hookName - The name of the hook to execute
   * @param cwd - Current working directory for command execution
   * @param signal - Abort signal to cancel execution
   * @returns The hook execution result
   */
  async executeHook(
    skill: Skill,
    hookName: keyof SkillHooks,
    cwd: string,
    signal: AbortSignal,
  ): Promise<HookResult> {
    // Get the script path for the hook
    const scriptPath = this.getScriptPath(skill, hookName);

    if (!scriptPath) {
      return {
        success: true,
        output: '',
      };
    }

    // Check if script file exists
    if (!fs.existsSync(scriptPath.path)) {
      return {
        success: true,
        output: '',
      };
    }

    try {
      // Set up environment variables for the hook
      const env = {
        ...process.env,
        SKILL_NAME: skill.name,
        SKILL_DIR: skill.skillDir,
        CLAUDE_SESSION_ID: this.getSessionId(skill),
      };

      // Determine how to execute the script based on its extension and shebang
      const command = this.buildScriptCommand(scriptPath.path);

      // Execute the hook script
      const { stdout, stderr } = await execAsync(command, {
        cwd,
        env,
        timeout: 30000, // 30 second timeout
        signal,
      });

      const output = stdout.trim() || stderr.trim() || '';

      return {
        success: true,
        output,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const exitCode = (error as any)?.code;

      return {
        success: false,
        output: '',
        error: errorMessage,
        exitCode,
      };
    }
  }

  /**
   * Execute multiple hooks in sequence
   *
   * @param skill - The skill whose hooks to execute
   * @param hookNames - Array of hook names to execute
   * @param cwd - Current working directory for command execution
   * @param signal - Abort signal to cancel execution
   * @returns Array of hook execution results
   */
  async executeHooks(
    skill: Skill,
    hookNames: Array<keyof SkillHooks>,
    cwd: string,
    signal: AbortSignal,
  ): Promise<HookResult[]> {
    const results: HookResult[] = [];

    for (const hookName of hookNames) {
      const result = await this.executeHook(skill, hookName, cwd, signal);
      results.push(result);

      // Stop if signal is aborted
      if (signal.aborted) {
        break;
      }
    }

    return results;
  }

  /**
   * Get the script path for a hook
   *
   * @param skill - The skill
   * @param hookName - The name of the hook
   * @returns Object with path, or null if hook not defined
   */
  private getScriptPath(
    skill: Skill,
    hookName: keyof SkillHooks,
  ): { path: string } | null {
    const scriptName = skill.frontmatter.hooks?.[hookName];

    if (!scriptName) {
      return null;
    }

    const scriptPath = path.join(skill.skillDir, 'scripts', scriptName);

    return {
      path: scriptPath,
    };
  }

  /**
   * Build the command to execute a script, handling interpreters
   *
   * @param scriptPath - Absolute path to the script
   * @returns The command string to execute
   */
  private buildScriptCommand(scriptPath: string): string {
    const ext = path.extname(scriptPath).toLowerCase();

    // Check file extension for known interpreters
    switch (ext) {
      case '.py':
        return `python3 "${scriptPath}"`;
      case '.js':
        return `node "${scriptPath}"`;
      case '.ts':
        return `npx tsx "${scriptPath}"`;
      case '.sh':
        return `bash "${scriptPath}"`;
      case '.bash':
        return `bash "${scriptPath}"`;
      case '.zsh':
        return `zsh "${scriptPath}"`;
      case '.rb':
        return `ruby "${scriptPath}"`;
      case '.php':
        return `php "${scriptPath}"`;
      default:
        // For other files, try to execute directly (might have shebang)
        // Also handle files without extension by checking shebang
        try {
          const content = fs.readFileSync(scriptPath, 'utf-8');
          const firstLine = content.split('\n')[0];

          if (firstLine.startsWith('#!')) {
            // Extract interpreter from shebang
            const shebang = firstLine.slice(2).trim();
            // Handle '#!/usr/bin/env python' style
            if (shebang.startsWith('/usr/bin/env ')) {
              const interpreter = shebang.slice('/usr/bin/env '.length).split(' ')[0];
              return `${interpreter} "${scriptPath}"`;
            }
            // Handle direct interpreter path like '#!/usr/bin/python3'
            return `${shebang} "${scriptPath}"`;
          }
        } catch {
          // If we can't read the file, fall through to direct execution
        }
        // Fallback: try direct execution
        return `"${scriptPath}"`;
    }
  }

  /**
   * Get session ID from skill
   *
   * This is a placeholder - in a real implementation, this would
   * come from the config or session context
   *
   * @param _skill - The skill
   * @returns Session ID string or empty string
   */
  private getSessionId(_skill: Skill): string {
    // This would be passed in from the config in a real implementation
    return process.env.CLAUDE_SESSION_ID || '';
  }

  /**
   * Check if a hook script exists
   *
   * @param skill - The skill
   * @param hookName - The name of the hook
   * @returns True if the hook script exists
   */
  hookExists(skill: Skill, hookName: keyof SkillHooks): boolean {
    const scriptName = skill.frontmatter.hooks?.[hookName];

    if (!scriptName) {
      return false;
    }

    const scriptPath = path.join(skill.skillDir, 'scripts', scriptName);
    return fs.existsSync(scriptPath);
  }

  /**
   * Get all defined hooks for a skill
   *
   * @param skill - The skill
   * @returns Array of hook names that are defined
   */
  getDefinedHooks(skill: Skill): Array<keyof SkillHooks> {
    const hooks: Array<keyof SkillHooks> = [];
    const skillHooks = skill.frontmatter.hooks;

    if (skillHooks) {
      if (skillHooks.onLoad) hooks.push('onLoad');
      if (skillHooks.onActivate) hooks.push('onActivate');
      if (skillHooks.onDeactivate) hooks.push('onDeactivate');
      if (skillHooks.onUnload) hooks.push('onUnload');
    }

    return hooks;
  }
}