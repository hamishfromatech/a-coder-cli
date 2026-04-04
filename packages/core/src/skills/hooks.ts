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

  /** Environment variables written to CLAUDE_ENV_FILE (SessionStart hooks only) */
  envUpdates?: Record<string, string>;
}

/**
 * Hook executor for skill lifecycle scripts
 *
 * Hook scripts are located in the skill's scripts/ directory
 * and are executed via the shell.
 *
 * Environment variables provided to scripts:
 * - CLAUDE_PROJECT_DIR: Root path of the current project
 * - CLAUDE_PLUGIN_ROOT: Directory where the plugin/skill resides
 * - CLAUDE_ENV_FILE: Path to persist environment variables (SessionStart hooks only)
 * - CLAUDE_SESSION_ID: Current session identifier
 * - CLAUDE_CODE_REMOTE: Set to '1' if running in remote context
 * - SKILL_NAME: Name of the skill
 * - SKILL_DIR: Absolute path to skill directory
 */
export class SkillHookExecutor {
  /**
   * Execute a skill hook
   *
   * @param skill - The skill whose hook to execute
   * @param hookName - The name of the hook to execute
   * @param cwd - Current working directory for command execution
   * @param signal - Abort signal to cancel execution
   * @param envFile - Optional path to environment file for persisting variables
   * @returns The hook execution result
   */
  async executeHook(
    skill: Skill,
    hookName: keyof SkillHooks,
    cwd: string,
    signal: AbortSignal,
    envFile?: string,
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
      // Create a temporary env file handler for capturing env updates
      const envUpdates: Record<string, string> = {};
      const tempEnvFile = envFile || this.createTempEnvFile();

      // Set up environment variables for the hook (following Claude Code spec)
      const env = {
        ...process.env,
        // Claude Code standard variables
        CLAUDE_PROJECT_DIR: cwd,
        CLAUDE_PLUGIN_ROOT: skill.skillDir,
        CLAUDE_ENV_FILE: tempEnvFile,
        CLAUDE_SESSION_ID: this.getSessionId(skill),
        CLAUDE_CODE_REMOTE: process.env.CLAUDE_CODE_REMOTE || '',
        // A-Coder specific variables
        SKILL_NAME: skill.name,
        SKILL_DIR: skill.skillDir,
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

      // Read any environment updates written to the env file
      if (fs.existsSync(tempEnvFile)) {
        const envContent = fs.readFileSync(tempEnvFile, 'utf-8');
        const exportPattern = /^export\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*["']?([^"'\n]*)["']?/gm;
        let match: RegExpExecArray | null;

        while ((match = exportPattern.exec(envContent)) !== null) {
          const [, key, value] = match;
          envUpdates[key] = value;
        }

        // Clean up temp file if we created it
        if (!envFile && fs.existsSync(tempEnvFile)) {
          fs.unlinkSync(tempEnvFile);
        }
      }

      return {
        success: true,
        output,
        envUpdates: Object.keys(envUpdates).length > 0 ? envUpdates : undefined,
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
   * @param envFile - Optional path to environment file for persisting variables
   * @returns Array of hook execution results
   */
  async executeHooks(
    skill: Skill,
    hookNames: Array<keyof SkillHooks>,
    cwd: string,
    signal: AbortSignal,
    envFile?: string,
  ): Promise<HookResult[]> {
    const results: HookResult[] = [];

    for (const hookName of hookNames) {
      const result = await this.executeHook(skill, hookName, cwd, signal, envFile);
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
   * Following Claude Code skill scripts specification:
   * https://github.com/anthropics/claude-code/blob/main/plugins/plugin-dev/skills/hook-development/SKILL.md
   *
   * @param scriptPath - Absolute path to the script
   * @returns The command string to execute
   */
  private buildScriptCommand(scriptPath: string): string {
    const ext = path.extname(scriptPath).toLowerCase();

    // Check file extension for known interpreters
    switch (ext) {
      // Shell scripts
      case '.sh':
      case '.bash':
        return `bash "${scriptPath}"`;
      case '.zsh':
        return `zsh "${scriptPath}"`;
      case '.fish':
        return `fish "${scriptPath}"`;
      case '.ps1':
        return `powershell -ExecutionPolicy Bypass -File "${scriptPath}"`;
      case '.cmd':
      case '.bat':
        return `cmd.exe /c "${scriptPath}"`;

      // Python
      case '.py':
      case '.pyw':
        return `python3 "${scriptPath}"`;

      // Node.js
      case '.js':
      case '.mjs':
      case '.cjs':
        return `node "${scriptPath}"`;
      case '.ts':
      case '.tsx':
        return `npx tsx "${scriptPath}"`;

      // Ruby
      case '.rb':
        return `ruby "${scriptPath}"`;

      // PHP
      case '.php':
        return `php "${scriptPath}"`;

      // Perl
      case '.pl':
      case '.pm':
        return `perl "${scriptPath}"`;

      // Raku
      case '.raku':
      case '.rakumod':
        return `raku "${scriptPath}"`;

      // Lua
      case '.lua':
        return `lua "${scriptPath}"`;

      // Tcl
      case '.tcl':
        return `tclsh "${scriptPath}"`;

      // AWK
      case '.awk':
        return `awk -f "${scriptPath}"`;

      // SED
      case '.sed':
        return `sed -f "${scriptPath}"`;

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
   * @param _skill - The skill
   * @returns Session ID string or empty string
   */
  private getSessionId(_skill: Skill): string {
    return process.env.CLAUDE_SESSION_ID || '';
  }

  /**
   * Create a temporary environment file for capturing env updates
   *
   * @returns Path to the temporary env file
   */
  private createTempEnvFile(): string {
    const tmpDir = require('os').tmpdir();
    const randomId = Math.random().toString(36).substring(2, 15);
    return path.join(tmpDir, `claude-env-${randomId}.sh`);
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