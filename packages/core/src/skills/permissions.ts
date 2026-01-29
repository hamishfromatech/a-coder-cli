/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Skill } from './types.js';

/**
 * Permission rule for skill invocation
 */
export interface SkillPermissionRule {
  /** Whether this is an allow or deny rule */
  type: 'allow' | 'deny';

  /** Pattern to match skill names (supports wildcards: skill-name*) */
  pattern: string;
}

/**
 * Permission manager for skills
 *
 * Rules are evaluated in order:
 * 1. If a matching deny rule is found, deny
 * 2. If a matching allow rule is found, allow
 * 3. Default: allow (for user-invocable skills) or respect skill settings
 */
export class SkillPermissionManager {
  private rules: SkillPermissionRule[] = [];
  private defaultAllow: boolean = true;

  /**
   * Add a permission rule
   *
   * @param rule - The rule to add
   */
  addRule(rule: SkillPermissionRule): void {
    this.rules.push(rule);
  }

  /**
   * Add multiple permission rules
   *
   * @param rules - Array of rules to add
   */
  addRules(rules: SkillPermissionRule[]): void {
    this.rules.push(...rules);
  }

  /**
   * Clear all rules
   */
  clearRules(): void {
    this.rules = [];
  }

  /**
   * Set the default allow behavior
   *
   * @param allow - Whether to allow by default
   */
  setDefaultAllow(allow: boolean): void {
    this.defaultAllow = allow;
  }

  /**
   * Check if a skill can be invoked
   *
   * Takes into account:
   * 1. Permission rules (deny/allow)
   * 2. Skill's userInvocable setting
   * 3. Skill's disableModelInvocation setting (if byModel is true)
   *
   * @param skill - The skill to check
   * @param byModel - Whether the invocation is by the model (vs user)
   * @returns True if the skill can be invoked
   */
  canInvoke(skill: Skill, byModel: boolean = false): boolean {
    // Check model invocation permission
    if (byModel && skill.frontmatter.disableModelInvocation === true) {
      return false;
    }

    // Check user-invocable permission
    if (!byModel && skill.frontmatter.userInvocable === false) {
      return false;
    }

    // Check permission rules
    for (const rule of this.rules) {
      if (this.matchesPattern(skill, rule.pattern)) {
        return rule.type === 'allow';
      }
    }

    // Default behavior
    return this.defaultAllow;
  }

  /**
   * Filter skills based on permission rules
   *
   * @param skills - Array of skills to filter
   * @param byModel - Whether to filter for model invocation
   * @returns Filtered array of skills
   */
  filterSkills(skills: Skill[], byModel: boolean = false): Skill[] {
    return skills.filter((skill) => this.canInvoke(skill, byModel));
  }

  /**
   * Check if a skill matches a pattern
   *
   * Patterns can include wildcards (*):
   * - "test*" matches "test", "testing", "test-1"
   * - "vercel:*" matches "vercel:deploy", "vercel:logs"
   *
   * @param skill - The skill to check
   * @param pattern - The pattern to match against
   * @returns True if the skill matches the pattern
   */
  matchesPattern(skill: Skill, pattern: string): boolean {
    const skillName = skill.name.toLowerCase();
    const patternLower = pattern.toLowerCase();

    // Exact match
    if (skillName === patternLower) {
      return true;
    }

    // Wildcard match (suffix)
    if (patternLower.endsWith('*')) {
      const prefix = patternLower.slice(0, -1);
      if (skillName.startsWith(prefix)) {
        return true;
      }
    }

    // Wildcard match (prefix)
    if (patternLower.startsWith('*')) {
      const suffix = patternLower.slice(1);
      if (skillName.endsWith(suffix)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get all rules
   *
   * @returns Array of permission rules
   */
  getRules(): SkillPermissionRule[] {
    return [...this.rules];
  }
}

/**
 * Create a permission manager with default rules
 *
 * @param rules - Optional initial rules
 * @param defaultAllow - Default allow behavior
 * @returns A new permission manager
 */
export function createSkillPermissionManager(
  rules?: SkillPermissionRule[],
  defaultAllow: boolean = true,
): SkillPermissionManager {
  const manager = new SkillPermissionManager();
  if (rules) {
    manager.addRules(rules);
  }
  manager.setDefaultAllow(defaultAllow);
  return manager;
}

/**
 * Parse permission rules from settings
 *
 * Expected format:
 * ```json
 * {
 *   "skillPermissions": [
 *     { "type": "allow", "pattern": "test*" },
 *     { "type": "deny", "pattern": "dangerous*" }
 *   ]
 * }
 * ```
 *
 * @param settings - Settings object containing skillPermissions
 * @returns Array of parsed permission rules
 */
export function parsePermissionRules(
  settings: any,
): SkillPermissionRule[] {
  if (!settings || !settings.skillPermissions) {
    return [];
  }

  const rules: SkillPermissionRule[] = [];
  const rawRules = settings.skillPermissions;

  for (const rule of rawRules) {
    if (rule.type && rule.pattern) {
      if (rule.type === 'allow' || rule.type === 'deny') {
        rules.push({
          type: rule.type,
          pattern: String(rule.pattern),
        });
      }
    }
  }

  return rules;
}