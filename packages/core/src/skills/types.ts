/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Skill metadata from YAML frontmatter
 *
 * Follows the Agent Skills Specification from https://agentskills.io/specification
 * with additional extensions for A-Coder CLI specific features.
 */
export interface SkillFrontmatter {
  // === Agent Skills Spec Required Fields ===

  /**
   * Display name for the skill (required by spec)
   * Must be 1-64 characters, lowercase alphanumeric with hyphens
   * Must match the parent directory name
   */
  name: string;

  /**
   * Human-readable description of what the skill does (required by spec)
   * Must be 1-1024 characters
   * Should describe what the skill does and when to use it
   */
  description: string;

  // === Agent Skills Spec Optional Fields ===

  /**
   * License information for the skill
   * Max 500 characters
   */
  license?: string;

  /**
   * Environment compatibility requirements
   * Max 500 characters
   * Describes required tools, versions, or environment setup
   */
  compatibility?: string;

  /**
   * Arbitrary key-value metadata
   * Useful for storing additional skill configuration
   */
  metadata?: Record<string, unknown>;

  /**
   * Space-delimited list of pre-approved tools (spec format)
   * Tools that the skill can use without explicit user confirmation
   * @experimental
   */
  'allowed-tools'?: string;

  // === A-Coder CLI Extensions ===

  /**
   * Hint for command-line arguments (e.g., "<file>")
   * @extension
   */
  argumentHint?: string;

  /**
   * When true, model should not invoke the skill directly
   * @extension
   */
  disableModelInvocation?: boolean;

  /**
   * When true, users can invoke via slash commands (default: true)
   * @extension
   */
  userInvocable?: boolean;

  /**
   * Array of tools this skill requires (legacy format, prefer allowed-tools)
   * @extension
   * @deprecated Use allowed-tools instead for spec compliance
   */
  allowedTools?: string[];

  /**
   * Model to use for this skill (optional override)
   * @extension
   */
  model?: string;

  /**
   * Context handling mode: 'inline' or 'fork' (fork is validated but not executed)
   * @extension
   */
  context?: 'inline' | 'fork';

  /**
   * Agent to use for this skill (optional)
   * @extension
   */
  agent?: string;

  /**
   * Hook scripts to run at lifecycle events
   * @extension
   */
  hooks?: SkillHooks;
}

/**
 * Hook script definitions
 */
export interface SkillHooks {
  /** Script path in scripts/ directory to run when skill is loaded */
  onLoad?: string;

  /** Script path in scripts/ directory to run when skill is activated */
  onActivate?: string;

  /** Script path in scripts/ directory to run when skill is deactivated */
  onDeactivate?: string;

  /** Script path in scripts/ directory to run when skill is unloaded */
  onUnload?: string;
}

/**
 * Source type of a skill, affects priority
 */
export enum SkillSource {
  /** Enterprise-managed skills (highest priority) */
  Enterprise = 'enterprise',

  /** User's personal skills (~/.claude/skills/) */
  Personal = 'personal',

  /** Project-specific skills (.claude/skills/) */
  Project = 'project',

  /** Plugin skills (plugin-name:skill-name) */
  Plugin = 'plugin',

  /** Nested skills (<path>/.claude/skills/) */
  Nested = 'nested',
}

/**
 * Represents a discovered skill
 */
export interface Skill {
  /** Unique identifier: `${source}:${skillName}` or `${source}:${plugin}:${skillName}` for plugins */
  id: string;

  /** Display name: for plugins, "plugin-name:skill-name" */
  name: string;

  /** Human-readable description */
  description: string;

  /** Where the skill was discovered from */
  source: SkillSource;

  /** Parsed frontmatter metadata */
  frontmatter: SkillFrontmatter;

  /** The markdown content (after frontmatter) */
  content: string;

  /** Supporting files (templates, examples, scripts) - loaded lazily */
  supportingFiles: Map<string, string>;

  /** Absolute path to the skill directory */
  skillDir: string;
}

/**
 * Options for skill discovery
 */
export interface SkillDiscoveryOptions {
  /** Current working path for nested skill discovery */
  currentPath?: string;

  /** Whether to include nested skills from subdirectories */
  includeNested?: boolean;
}

/**
 * Internal structure for tracking file paths before lazy loading
 */
export interface SkillFileTracking {
  /** Map of filename to absolute path */
  supportingFilePaths: Map<string, string>;

  /** Files already loaded into memory */
  loadedFiles: Map<string, string>;
}