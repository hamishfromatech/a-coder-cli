/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Skill metadata from YAML frontmatter
 */
export interface SkillFrontmatter {
  /** Display name for the skill */
  name?: string;

  /** Human-readable description of what the skill does */
  description?: string;

  /** Hint for command-line arguments (e.g., "<file>") */
  argumentHint?: string;

  /** When true, model should not invoke the skill directly */
  disableModelInvocation?: boolean;

  /** When true, users can invoke via slash commands (default: true) */
  userInvocable?: boolean;

  /** List of tools this skill requires */
  allowedTools?: string[];

  /** Model to use for this skill (optional override) */
  model?: string;

  /** Context handling mode: 'inline' or 'fork' (fork is validated but not executed) */
  context?: 'inline' | 'fork';

  /** Agent to use for this skill (optional) */
  agent?: string;

  /** Hook scripts to run at lifecycle events */
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