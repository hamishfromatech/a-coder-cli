/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Skill, SkillSource } from './types.js';
import { SkillDiscovery } from './discovery.js';

/**
 * Skill registry with deduplication by id (including namespace)
 *
 * When multiple skills have the same name, the one with higher priority wins.
 * Priority is determined by the source type.
 */
export class SkillRegistry {
  private skills: Map<string, Skill> = new Map();

  /**
   * Register a skill, replacing any existing skill with the same id
   *
   * @param skill - The skill to register
   */
  register(skill: Skill): void {
    this.skills.set(skill.id, skill);
  }

  /**
   * Register multiple skills at once
   *
   * @param skills - Array of skills to register
   */
  registerAll(skills: Skill[]): void {
    for (const skill of skills) {
      this.register(skill);
    }
  }

  /**
   * Get a skill by id
   *
   * @param id - The unique skill id
   * @returns The skill or undefined if not found
   */
  get(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  /**
   * Get all registered skills
   *
   * @returns Array of all skills
   */
  getAll(): Skill[] {
    return Array.from(this.skills.values());
  }

  /**
   * Get skills by source type
   *
   * @param source - The source type to filter by
   * @returns Array of skills from the specified source
   */
  getBySource(source: SkillSource): Skill[] {
    return Array.from(this.skills.values()).filter(
      (skill) => skill.source === source,
    );
  }

  /**
   * Get skills that are user-invocable (have userInvocable: true or undefined)
   *
   * @returns Array of user-invocable skills
   */
  listUserInvocable(): Skill[] {
    return Array.from(this.skills.values()).filter(
      (skill) => skill.frontmatter.userInvocable !== false,
    );
  }

  /**
   * Get skills that are model-invocable (not disableModelInvocation: true)
   *
   * @returns Array of model-invocable skills
   */
  listModelInvocable(): Skill[] {
    return Array.from(this.skills.values()).filter(
      (skill) => skill.frontmatter.disableModelInvocation !== true,
    );
  }

  /**
   * Get a skill by name (with namespace if present)
   *
   * For example, "vercel:deploy" would match a plugin skill
   *
   * @param name - The skill name to look up
   * @returns The skill or undefined if not found
   */
  getByName(name: string): Skill | undefined {
    return Array.from(this.skills.values()).find(
      (skill) => skill.name === name,
    );
  }

  /**
   * Resolve a skill name with namespace, considering current path for nested skills
   *
   * This handles:
   * - Exact name matches (e.g., "vercel:deploy")
   * - Simple name matches (e.g., "test")
   * - Namespace-aware resolution
   *
   * @param name - The skill name to resolve
   * @param currentPath - Optional current path for nested skill resolution
   * @returns The resolved skill or undefined if not found
   */
  resolveName(name: string, currentPath?: string): Skill | undefined {
    // Try exact match first
    const exactMatch = this.getByName(name);
    if (exactMatch) {
      return exactMatch;
    }

    // If no colon in name, it might be a simple name without namespace
    // Check if there's exactly one skill with this simple name
    if (!name.includes(':')) {
      const candidates = Array.from(this.skills.values()).filter(
        (skill) => skill.name === name ||
                   skill.name.endsWith(`:${name}`),
      );

      if (candidates.length === 1) {
        return candidates[0];
      }

      // If there are multiple candidates, prefer Personal over Project over Plugin over Nested
      const priorityOrder = [SkillSource.Personal, SkillSource.Project, SkillSource.Plugin, SkillSource.Nested];
      for (const source of priorityOrder) {
        const match = candidates.find((skill) => skill.source === source);
        if (match) {
          return match;
        }
      }
    }

    // Check nested skills if currentPath is provided
    if (currentPath) {
      const nestedSkills = this.getBySource(SkillSource.Nested);
      for (const skill of nestedSkills) {
        const skillName = skill.name.split(':').pop() || skill.name;
        if (skillName === name) {
          return skill;
        }
      }
    }

    return undefined;
  }

  /**
   * Get the number of registered skills
   *
   * @returns The count of registered skills
   */
  size(): number {
    return this.skills.size;
  }

  /**
   * Clear all registered skills
   */
  clear(): void {
    this.skills.clear();
  }

  /**
   * Check if a skill with the given id exists
   *
   * @param id - The skill id to check
   * @returns True if the skill exists
   */
  has(id: string): boolean {
    return this.skills.has(id);
  }

  /**
   * Delete a skill by id
   *
   * @param id - The skill id to delete
   * @returns True if the skill was deleted, false if it didn't exist
   */
  delete(id: string): boolean {
    return this.skills.delete(id);
  }
}

/**
 * Create a skill registry from a skill discovery
 *
 * @param discovery - The skill discovery instance
 * @returns A populated skill registry
 */
export async function createSkillRegistryFromDiscovery(
  discovery: SkillDiscovery,
): Promise<SkillRegistry> {
  const registry = new SkillRegistry();
  const skills = await discovery.discoverAll();
  registry.registerAll(skills);
  return registry;
}