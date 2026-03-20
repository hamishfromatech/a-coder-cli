/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Source type for an agent definition
 * Re-exported from subagent-types for convenience
 */
export type { AgentSourceType } from '../tools/subagent-types.js';

/**
 * Agent source constants
 */
export const AGENT_SOURCE = {
  BUILTIN: 'builtin',
  USER: 'user',
  PROJECT: 'project',
  PLUGIN: 'plugin',
} as const;

/**
 * Agent definition frontmatter from YAML
 */
export interface AgentFrontmatter {
  /** Display name for the agent */
  name: string;

  /** Human-readable description of what the agent does */
  description: string;

  /** Model to use: 'haiku' | 'sonnet' | 'opus' | 'inherit' */
  model?: string;

  /** Color for UI display */
  color?: string;

  /** Tools this agent is allowed to use (allowlist) */
  tools?: string[];

  /** Tools this agent is blocked from using (denylist) */
  disallowedTools?: string[];

  /** Additional metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Complete agent definition
 */
export interface AgentDefinition {
  /** Unique identifier (e.g., 'builtin:Explore', 'user:my-agent') */
  id: string;

  /** Display name */
  name: string;

  /** Human-readable description */
  description: string;

  /** Model to use */
  model: string;

  /** Color for UI display */
  color?: string;

  /** Allowed tools */
  allowedTools: string[];

  /** Disallowed tools */
  disallowedTools: string[];

  /** System prompt content */
  systemPrompt?: string;

  /** Where this agent was loaded from */
  source: AgentSourceType;

  /** File path (for file-based agents) */
  filePath?: string;
}

import type { AgentSourceType } from '../tools/subagent-types.js';

/**
 * Options for agent discovery
 */
export interface AgentDiscoveryOptions {
  /** Current working directory for project-level discovery */
  cwd?: string;

  /** Whether to include user-level agents */
  includeUser?: boolean;

  /** Whether to include project-level agents */
  includeProject?: boolean;
}

/**
 * Agent file name convention
 */
export const AGENT_FILE_NAME = 'AGENT.md';

/**
 * Agent file extension for markdown
 */
export const AGENT_FILE_EXTENSIONS = ['.md', '.markdown'];