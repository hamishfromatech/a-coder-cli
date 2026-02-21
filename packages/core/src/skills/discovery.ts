/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { Config } from '../config/config.js';
import { GEMINI_DIR } from '../utils/paths.js';
import { Skill, SkillSource, SkillDiscoveryOptions, SkillFileTracking } from './types.js';
import { parseFrontmatter, extractDescriptionFromContent, SkillFrontmatterError } from './frontmatter.js';

/**
 * Skill discovery with multi-location support and priority resolution
 *
 * Priority (highest to lowest):
 * Enterprise (4) > Personal (3) > Project (2) > Plugin (1) > Nested (0)
 */
export class SkillDiscovery {
  private fileTracking: Map<string, SkillFileTracking> = new Map();

  constructor(private readonly config: Config) {}

  /**
   * Discover all skills from all locations
   *
   * @param options - Discovery options
   * @returns Array of discovered skills
   */
  async discoverAll(options?: SkillDiscoveryOptions): Promise<Skill[]> {
    const skills: Skill[] = [];

    // Discover from each location in priority order
    // Higher priority skills are added first, so they will override lower priority ones

    // 1. Enterprise skills (not implemented - reserved for future)
    // skills.push(...await this.discoverEnterpriseSkills());

    // 2. Personal skills: ~/.claude/skills/<skill-name>/SKILL.md
    const personalSkills = await this.discoverFromLocation(
      path.join(os.homedir(), '.claude', 'skills'),
      SkillSource.Personal,
    );
    skills.push(...personalSkills);

    // 3. Project skills: .claude/skills/<skill-name>/SKILL.md
    const projectSkillsDir = path.join(this.config.getTargetDir(), GEMINI_DIR, 'skills');
    const projectSkills = await this.discoverFromLocation(projectSkillsDir, SkillSource.Project);
    skills.push(...projectSkills);

    // 3.5. a-coder-cli project skills: .a-coder-cli/skills/<skill-name>/SKILL.md
    const aCoderCliProjectSkillsDir = path.join(this.config.getTargetDir(), '.a-coder-cli', 'skills');
    const aCoderCliProjectSkills = await this.discoverFromLocation(aCoderCliProjectSkillsDir, SkillSource.Project);
    skills.push(...aCoderCliProjectSkills);

    // 4. Plugin skills (not implemented in this initial version)
    // Would be discovered from plugin directories

    // 5. Nested skills: <current-path>/.claude/skills/<skill-name>/SKILL.md
    if (options?.includeNested && options.currentPath) {
      const nestedSkillsDir = path.join(options.currentPath, GEMINI_DIR, 'skills');
      const nestedSkills = await this.discoverFromLocation(nestedSkillsDir, SkillSource.Nested);
      skills.push(...nestedSkills);
    }

    // 6. Legacy skills: ~/.a-coder-cli/skills/<skill-name>/SKILL.md (backward compatibility)
    const legacySkillsDir = path.join(os.homedir(), GEMINI_DIR, 'skills');
    const legacySkills = await this.discoverFromLocation(legacySkillsDir, SkillSource.Personal);
    skills.push(...legacySkills);

    return skills;
  }

  /**
   * Discover skills from a specific location
   *
   * @param location - Directory path to search for skills
   * @param source - Source type of the skills
   * @param pluginName - Optional plugin name for namespace
   * @returns Array of discovered skills
   */
  async discoverFromLocation(
    location: string,
    source: SkillSource,
    pluginName?: string,
  ): Promise<Skill[]> {
    const skills: Skill[] = [];

    if (!fs.existsSync(location)) {
      return skills;
    }

    try {
      const entries = fs.readdirSync(location, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const skillDir = path.join(location, entry.name);
        const skill = await this.loadSkill(skillDir, source, pluginName);

        if (skill) {
          skills.push(skill);
        }
      }
    } catch (error) {
      // Silently skip locations that can't be read
      console.warn(`Warning: Could not read skills from ${location}: ${error}`);
    }

    return skills;
  }

  /**
   * Load a single skill from a directory
   *
   * @param skillDir - Directory containing the skill
   * @param source - Source type of the skill
   * @param pluginName - Optional plugin name for namespace
   * @returns Skill object or null if loading fails
   */
  async loadSkill(
    skillDir: string,
    source: SkillSource,
    pluginName?: string,
  ): Promise<Skill | null> {
    const skillPath = path.join(skillDir, 'SKILL.md');

    if (!fs.existsSync(skillPath)) {
      return null;
    }

    try {
      const content = fs.readFileSync(skillPath, 'utf-8');
      const dirName = path.basename(skillDir);

      // Parse frontmatter with directory name for validation
      const { frontmatter, content: markdownContent } = parseFrontmatter(
        content,
        dirName,
      );

      // Use frontmatter name (required by spec, validated in parseFrontmatter)
      const displayName = frontmatter.name;

      // Build skill name with namespace for plugins
      const name = pluginName ? `${pluginName}:${displayName}` : displayName;

      // Build unique ID
      const id = pluginName
        ? `${source}:${pluginName}:${displayName}`
        : `${source}:${displayName}`;

      // Description is required by spec, but fallback to content extraction
      const description =
        frontmatter.description ||
        extractDescriptionFromContent(markdownContent);

      // Track supporting file paths for lazy loading
      this.trackSupportingFiles(id, skillDir);

      const skill: Skill = {
        id,
        name,
        description,
        source,
        frontmatter,
        content: markdownContent,
        supportingFiles: new Map(),
        skillDir,
      };

      return skill;
    } catch (error) {
      if (error instanceof SkillFrontmatterError) {
        console.warn(
          `Warning: Invalid skill frontmatter in ${skillDir}: ${error.message}`,
        );
      } else {
        console.warn(`Warning: Could not load skill from ${skillDir}: ${error}`);
      }
      return null;
    }
  }

  /**
   * Get priority value for a skill source
   *
   * @param source - The skill source
   * @returns Priority number (higher = more important)
   */
  getSkillPriority(source: SkillSource): number {
    switch (source) {
      case SkillSource.Enterprise:
        return 4;
      case SkillSource.Personal:
        return 3;
      case SkillSource.Project:
        return 2;
      case SkillSource.Plugin:
        return 1;
      case SkillSource.Nested:
        return 0;
      default:
        return 0;
    }
  }

  /**
   * Track supporting file paths for a skill (lazy loading)
   *
   * @param skillId - The skill's unique ID
   * @param skillDir - The skill directory
   */
  private trackSupportingFiles(skillId: string, skillDir: string): void {
    const tracking: SkillFileTracking = {
      supportingFilePaths: new Map(),
      loadedFiles: new Map(),
    };

    if (!fs.existsSync(skillDir)) {
      this.fileTracking.set(skillId, tracking);
      return;
    }

    try {
      const scanDirectory = (dirPath: string, relativePath = ''): void => {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          const entryPath = path.join(dirPath, entry.name);
          const relativeEntryPath = path.join(relativePath, entry.name);

          // Skip SKILL.md
          if (entry.name === 'SKILL.md') {
            continue;
          }

          if (entry.isDirectory()) {
            // Recursively scan subdirectories
            scanDirectory(entryPath, relativeEntryPath);
          } else {
            // Track file path
            tracking.supportingFilePaths.set(relativeEntryPath, entryPath);
          }
        }
      };

      scanDirectory(skillDir);
      this.fileTracking.set(skillId, tracking);
    } catch (error) {
      console.warn(`Warning: Could not scan skill directory ${skillDir}: ${error}`);
      this.fileTracking.set(skillId, tracking);
    }
  }

  /**
   * Load a supporting file content on demand
   *
   * @param skill - The skill object
   * @param filename - The filename to load (relative to skill dir)
   * @returns File content or null if not found
   */
  loadSupportingFile(skill: Skill, filename: string): string | null {
    const tracking = this.fileTracking.get(skill.id);

    if (!tracking) {
      return null;
    }

    // Check if already loaded
    if (tracking.loadedFiles.has(filename)) {
      return tracking.loadedFiles.get(filename)!;
    }

    // Get file path
    const filePath = tracking.supportingFilePaths.get(filename);
    if (!filePath || !fs.existsSync(filePath)) {
      return null;
    }

    // Load file content
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      tracking.loadedFiles.set(filename, content);
      return content;
    } catch (error) {
      console.warn(`Warning: Could not read supporting file ${filePath}: ${error}`);
      return null;
    }
  }

  /**
   * Get all available supporting file names for a skill
   *
   * @param skill - The skill object
   * @returns Array of filenames (relative to skill dir)
   */
  getSupportingFileNames(skill: Skill): string[] {
    const tracking = this.fileTracking.get(skill.id);
    if (!tracking) {
      return [];
    }
    return Array.from(tracking.supportingFilePaths.keys());
  }
}

/**
 * Get the personal skills directory path
 *
 * @returns Absolute path to personal skills directory
 */
export function getPersonalSkillsDir(): string {
  return path.join(os.homedir(), '.claude', 'skills');
}

/**
 * Get the project skills directory path
 *
 * @param projectRoot - The project root directory
 * @returns Absolute path to project skills directory
 */
export function getProjectSkillsDir(projectRoot: string): string {
  return path.join(projectRoot, GEMINI_DIR, 'skills');
}

/**
 * Get the a-coder-cli project skills directory path
 *
 * @param projectRoot - The project root directory
 * @returns Absolute path to a-coder-cli project skills directory
 */
export function getACoderCliProjectSkillsDir(projectRoot: string): string {
  return path.join(projectRoot, '.a-coder-cli', 'skills');
}

/**
 * Get the legacy skills directory path (for backward compatibility)
 *
 * @returns Absolute path to legacy skills directory
 */
export function getLegacySkillsDir(): string {
  return path.join(os.homedir(), GEMINI_DIR, 'skills');
}