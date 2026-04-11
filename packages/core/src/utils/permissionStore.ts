/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'os';
import crypto from 'crypto';
import { ToolPermissionMatcher } from './toolPermissionMatcher.js';
import { GEMINI_DIR } from './paths.js';

export interface PermissionRule {
  id: string;
  toolName: string;
  pattern: string;
  scope: 'tool' | 'server' | 'command';
  grantedAt: string;
}

const PERMISSIONS_FILENAME = 'permissions.json';

/**
 * Generates a unique ID for a permission rule.
 */
function generateRuleId(): string {
  return crypto.randomUUID();
}

/**
 * Builds a permission pattern string from a tool name and optional args.
 */
function buildPattern(toolName: string, args: Record<string, unknown>): string {
  // For tools with a 'command' arg (like Shell), use Bash(rootCommand) pattern
  if (args.command && typeof args.command === 'string') {
    const rootCommand = args.command.split(/\s+/)[0];
    if (rootCommand) {
      return `${toolName}(${rootCommand})`;
    }
  }

  // For tools with a 'serverName' arg (like MCP tools), use the server/tool pattern
  if (args.serverName && typeof args.serverName === 'string') {
    return `${toolName}(${args.serverName})`;
  }

  // Default: just the tool name
  return toolName;
}

/**
 * Determines the appropriate scope from a ToolConfirmationOutcome.
 */
function scopeFromOutcome(outcome: string): 'tool' | 'server' | 'command' {
  switch (outcome) {
    case 'proceed_always_server':
      return 'server';
    case 'proceed_always_tool':
      return 'tool';
    case 'proceed_always':
    default:
      return 'command';
  }
}

export class PermissionStore {
  private rules: PermissionRule[] = [];
  private filePath: string;
  private loaded = false;

  constructor(configDir?: string) {
    const baseDir = configDir ?? path.join(os.homedir(), GEMINI_DIR);
    this.filePath = path.join(baseDir, PERMISSIONS_FILENAME);
  }

  /**
   * Load rules from the permissions file on disk.
   * Handles missing files, corrupt JSON, and missing directories gracefully.
   */
  async load(): Promise<void> {
    if (this.loaded) {
      return;
    }

    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.rules = parsed.filter(isValidPermissionRule);
      } else {
        this.rules = [];
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        // File does not exist yet, start with empty rules
        this.rules = [];
      } else if ((error as NodeJS.ErrnoException).code === 'ENOTDIR') {
        // Path prefix exists but is not a directory; start fresh
        this.rules = [];
      } else {
        // Corrupt file or other error; reset to empty
        this.rules = [];
      }
    }

    this.loaded = true;
  }

  /**
   * Persist the current rules to disk.
   * Creates the parent directory if it does not exist.
   */
  async save(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(this.rules, null, 2), 'utf-8');
    } catch {
      // Silently handle write errors (e.g. permission denied).
      // The in-memory rules remain valid for the current session.
    }
  }

  /**
   * Add a new permission rule and persist it.
   */
  async addRule(
    toolName: string,
    args: Record<string, unknown>,
    scope: 'tool' | 'server' | 'command',
  ): Promise<PermissionRule> {
    await this.load();

    const pattern = buildPattern(toolName, args);

    // Avoid duplicates
    const exists = this.rules.some(
      (r) => r.toolName === toolName && r.pattern === pattern && r.scope === scope,
    );
    if (exists) {
      const existing = this.rules.find(
        (r) => r.toolName === toolName && r.pattern === pattern && r.scope === scope,
      );
      return existing!;
    }

    const rule: PermissionRule = {
      id: generateRuleId(),
      toolName,
      pattern,
      scope,
      grantedAt: new Date().toISOString(),
    };

    this.rules.push(rule);
    await this.save();
    return rule;
  }

  /**
   * Remove a rule by ID and persist.
   */
  async removeRule(id: string): Promise<boolean> {
    await this.load();

    const index = this.rules.findIndex((r) => r.id === id);
    if (index === -1) {
      return false;
    }

    this.rules.splice(index, 1);
    await this.save();
    return true;
  }

  /**
   * Check if there is a persisted rule that matches the given tool call.
   * Uses ToolPermissionMatcher for pattern matching.
   */
  async checkPermission(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<boolean> {
    await this.load();

    return this.rules.some((rule) =>
      ToolPermissionMatcher.matches(toolName, args, rule.pattern),
    );
  }

  /**
   * Check if a specific rule exists by tool name and pattern.
   */
  async hasRule(toolName: string, pattern: string): Promise<boolean> {
    await this.load();

    return this.rules.some(
      (r) => r.toolName === toolName && r.pattern === pattern,
    );
  }

  /**
   * Return all stored rules (for display / listing).
   */
  async getRules(): Promise<PermissionRule[]> {
    await this.load();
    return [...this.rules];
  }
}

/**
 * Validate that an object conforms to the PermissionRule interface.
 */
function isValidPermissionRule(obj: unknown): obj is PermissionRule {
  if (typeof obj !== 'object' || obj === null) {
    return false;
  }
  const record = obj as Record<string, unknown>;
  return (
    typeof record.id === 'string' &&
    typeof record.toolName === 'string' &&
    typeof record.pattern === 'string' &&
    (record.scope === 'tool' || record.scope === 'server' || record.scope === 'command') &&
    typeof record.grantedAt === 'string'
  );
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let singleton: PermissionStore | null = null;

/**
 * Returns the singleton PermissionStore instance.
 */
export function getPermissionStore(): PermissionStore {
  if (!singleton) {
    singleton = new PermissionStore();
  }
  return singleton;
}

// ---------------------------------------------------------------------------
// Convenience: derive scope from ToolConfirmationOutcome value string
// ---------------------------------------------------------------------------

export { scopeFromOutcome };
