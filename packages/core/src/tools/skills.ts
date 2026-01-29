/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import fs from 'fs';
import os from 'os';
import { BaseTool, ToolResult } from './tools.js';
import { Type } from '@google/genai';
import { GEMINI_DIR } from '../utils/paths.js';
import { SchemaValidator } from '../utils/schemaValidator.js';
import {
  parseFrontmatter,
  extractDescriptionFromContent,
} from '../skills/frontmatter.js';
import {
  substituteArguments,
  parseArguments,
} from '../skills/substitution.js';
import {
  processDynamicCommands,
  hasDynamicCommands,
} from '../skills/dynamic.js';
import {
  getPersonalSkillsDir,
  getProjectSkillsDir,
  getLegacySkillsDir,
} from '../skills/discovery.js';

/**
 * Parameters for the skills tool
 */
export interface SkillsToolParams {
  /** The action to perform */
  action: 'list' | 'load' | 'execute';

  /** The name of the skill (required for load and execute) */
  skill_name?: string;

  /** Arguments to pass to the skill (for execute action) */
  arguments?: string;

  /** Internal: Session ID for substitution (do not set directly) */
  _sessionId?: string;

  /** Internal: Current path for nested skill resolution (do not set directly) */
  _currentPath?: string;
}

export const getSkillsDir = () => path.join(os.homedir(), GEMINI_DIR, 'skills');

/**
 * Get available skill names from the legacy skills directory
 * @deprecated Use SkillDiscovery instead
 */
export const getAvailableSkills = (): string[] => {
  const skillsDir = getSkillsDir();
  if (!fs.existsSync(skillsDir)) {
    return [];
  }
  try {
    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    return entries
      .filter((dirent) => dirent.isDirectory())
      .filter((dirent) =>
        fs.existsSync(path.join(skillsDir, dirent.name, 'SKILL.md')),
      )
      .map((dirent) => dirent.name);
  } catch (error) {
    console.error('Error listing skills:', error);
    return [];
  }
};

/**
 * Search for a skill file by name across multiple locations
 *
 * @param skillName - The skill name to search for
 * @param projectRoot - The project root directory
 * @param currentPath - Optional current path for nested skills
 * @returns The path to the skill's SKILL.md file, or null if not found
 */
export function findSkillFile(
  skillName: string,
  projectRoot: string,
  currentPath?: string,
): string | null {
  // Check for namespace prefix (e.g., "vercel:deploy")
  if (skillName.includes(':')) {
    // Plugin skills - not implemented in this version
    return null;
  }

  const locations: string[] = [
    // Personal skills: ~/.claude/skills/
    path.join(getPersonalSkillsDir(), skillName, 'SKILL.md'),
    // Project skills: .claude/skills/
    path.join(getProjectSkillsDir(projectRoot), skillName, 'SKILL.md'),
    // Legacy skills: ~/.a-coder-cli/skills/
    path.join(getLegacySkillsDir(), skillName, 'SKILL.md'),
  ];

  // Add nested skills if currentPath is provided
  if (currentPath) {
    locations.unshift(
      path.join(currentPath, GEMINI_DIR, 'skills', skillName, 'SKILL.md'),
    );
  }

  for (const skillPath of locations) {
    if (fs.existsSync(skillPath)) {
      return skillPath;
    }
  }

  return null;
}

/**
 * Read and parse a skill file
 *
 * @param skillPath - Path to the skill's SKILL.md file
 * @returns Object with parsed skill data
 */
export function readSkillFile(skillPath: string): {
  content: string;
  frontmatter: any;
  markdown: string;
  skillDir: string;
} | null {
  if (!fs.existsSync(skillPath)) {
    return null;
  }

  try {
    const content = fs.readFileSync(skillPath, 'utf-8');
    const { frontmatter, content: markdown } = parseFrontmatter(content);
    const skillDir = path.dirname(skillPath);

    return {
      content,
      frontmatter,
      markdown,
      skillDir,
    };
  } catch (error) {
    console.error('Error reading skill file:', error);
    return null;
  }
}

export class SkillsTool extends BaseTool<SkillsToolParams, ToolResult> {
  static readonly Name: string = 'skills';
  private readonly skillsDir: string;
  private readonly projectRoot: string;

  constructor(private config?: any) {
    super(
      SkillsTool.Name,
      'Skills',
      'Manage and load specialized skills to enhance capabilities. Use "list" to see available skills, "load" to load a skill into context, and "execute" to run a skill as a standalone command.',
      {
        properties: {
          action: {
            type: Type.STRING,
            enum: ['list', 'load', 'execute'],
            description:
              'The action to perform: "list" to show available skills, "load" to load a skill into context, "execute" to run a skill as a standalone command.',
          },
          skill_name: {
            type: Type.STRING,
            description:
              'The name of the skill (required if action is "load" or "execute"). Can include namespace prefix for plugin skills (e.g., "vercel:deploy").',
          },
          arguments: {
            type: Type.STRING,
            description:
              'Arguments to pass to the skill (only for "execute" action). These will be available as $ARGUMENTS, $1, $2, etc. in the skill content.',
          },
          _sessionId: {
            type: Type.STRING,
            description:
              'Internal parameter for session ID (do not set directly)',
          },
          _currentPath: {
            type: Type.STRING,
            description:
              'Internal parameter for current path (do not set directly)',
          },
        },
        required: ['action'],
        type: Type.OBJECT,
      },
    );
    this.skillsDir = getSkillsDir();
    this.projectRoot = config?.getTargetDir?.() || process.cwd();
  }

  validateToolParams(params: SkillsToolParams): string | null {
    const errors = SchemaValidator.validate(this.schema.parameters, params);
    if (errors) {
      return errors;
    }
    if ((params.action === 'load' || params.action === 'execute') && !params.skill_name) {
      return 'The "skill_name" parameter is required when action is "load" or "execute".';
    }
    return null;
  }

  async execute(
    params: SkillsToolParams,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    const validationError = this.validateToolParams(params);
    if (validationError) {
      return {
        llmContent: `Error: Invalid parameters provided. Reason: ${validationError}`,
        returnDisplay: validationError,
      };
    }

    // Ensure skills directory exists
    if (!fs.existsSync(this.skillsDir)) {
      try {
        fs.mkdirSync(this.skillsDir, { recursive: true });
      } catch (error) {
        return {
          llmContent: `Error: Could not create skills directory at ${this.skillsDir}.`,
          returnDisplay: `Error: Could not create skills directory at ${this.skillsDir}.`,
        };
      }
    }

    if (params.action === 'list') {
      return this.executeList();
    } else if (params.action === 'load') {
      return await this.executeLoad(params, signal);
    } else if (params.action === 'execute') {
      return await this.executeExecute(params, signal);
    }

    return {
      llmContent: 'Unknown action.',
      returnDisplay: 'Unknown action.',
    };
  }

  /**
   * Execute the list action
   */
  private executeList(): ToolResult {
    try {
      // Collect skills from all locations
      const skills: Map<string, { name: string; description: string; source: string }> = new Map();

      // Helper to add skills from a directory
      const addSkillsFromDir = (dirPath: string, source: string): void => {
        if (!fs.existsSync(dirPath)) {
          return;
        }
        try {
          const entries = fs.readdirSync(dirPath, { withFileTypes: true });
          for (const entry of entries) {
            if (!entry.isDirectory()) {
              continue;
            }
            const skillPath = path.join(dirPath, entry.name, 'SKILL.md');
            if (!fs.existsSync(skillPath)) {
              continue;
            }
            const skillData = readSkillFile(skillPath);
            if (skillData) {
              const description = skillData.frontmatter.description ||
                extractDescriptionFromContent(skillData.markdown);
              skills.set(entry.name, {
                name: entry.name,
                description,
                source,
              });
            }
          }
        } catch (error) {
          console.warn(`Warning: Could not list skills from ${dirPath}: ${error}`);
        }
      };

      // Add skills from personal, project, and legacy locations
      addSkillsFromDir(getPersonalSkillsDir(), 'Personal');
      addSkillsFromDir(getProjectSkillsDir(this.projectRoot), 'Project');
      addSkillsFromDir(getLegacySkillsDir(), 'Legacy');

      if (skills.size === 0) {
        return {
          llmContent: 'No skills found. Create skills in ~/.claude/skills/ or .claude/skills/ directories.',
          returnDisplay: 'No skills found.',
        };
      }

      // Format output
      const skillList = Array.from(skills.values())
        .map((skill) => {
          const sourceTag = skill.source === 'Project' ? '[Project]' :
                          skill.source === 'Legacy' ? '[Legacy]' : '[Personal]';
          return `- ${skill.name} ${sourceTag}: ${skill.description}`;
        })
        .join('\n');

      return {
        llmContent: `Available skills:\n${skillList}`,
        returnDisplay: `Found ${skills.size} skill(s): ${Array.from(skills.keys()).join(', ')}`,
      };
    } catch (error) {
      return {
        llmContent: `Error listing skills: ${error}`,
        returnDisplay: `Error listing skills.`,
      };
    }
  }

  /**
   * Execute the load action
   */
  private async executeLoad(
    params: SkillsToolParams,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    const skillName = params.skill_name!;
    const currentPath = params._currentPath || this.config?.getWorkingDir?.();

    const skillPath = findSkillFile(skillName, this.projectRoot, currentPath);

    if (!skillPath) {
      return {
        llmContent: `Skill "${skillName}" not found in any skill directory.`,
        returnDisplay: `Skill "${skillName}" not found.`,
      };
    }

    const skillData = readSkillFile(skillPath);
    if (!skillData) {
      return {
        llmContent: `Error reading skill "${skillName}".`,
        returnDisplay: `Error loading skill ${skillName}.`,
      };
    }

    // Check disableModelInvocation
    if (skillData.frontmatter.disableModelInvocation === true) {
      return {
        llmContent: `Skill "${skillName}" cannot be invoked by the model (disableModelInvocation: true).`,
        returnDisplay: `Skill "${skillName}" cannot be invoked by the model.`,
      };
    }

    try {
      // Process content with substitutions and dynamic commands
      const sessionId = params._sessionId || this.config?.getSessionId?.() || '';
      const cwd = this.config?.getWorkingDir?.() || process.cwd();

      let content = skillData.markdown;

      // Apply argument substitutions (empty args for load action)
      content = substituteArguments(content, [], sessionId);

      // Process dynamic commands if present
      if (hasDynamicCommands(content)) {
        content = await processDynamicCommands(content, cwd, signal);
      }

      const displayName = skillData.frontmatter.name || skillName;
      const message = `Loaded Skill: ${displayName}\n\nInstructions:\n${content}`;

      return {
        llmContent: message,
        returnDisplay: `Loaded skill: ${skillName}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Error processing skill "${skillName}": ${errorMessage}`,
        returnDisplay: `Error processing skill ${skillName}.`,
      };
    }
  }

  /**
   * Execute the execute action (run skill as standalone command)
   */
  private async executeExecute(
    params: SkillsToolParams,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    const skillName = params.skill_name!;
    const currentPath = params._currentPath || this.config?.getWorkingDir?.();

    const skillPath = findSkillFile(skillName, this.projectRoot, currentPath);

    if (!skillPath) {
      return {
        llmContent: `Skill "${skillName}" not found in any skill directory.`,
        returnDisplay: `Skill "${skillName}" not found.`,
      };
    }

    const skillData = readSkillFile(skillPath);
    if (!skillData) {
      return {
        llmContent: `Error reading skill "${skillName}".`,
        returnDisplay: `Error loading skill ${skillName}.`,
      };
    }

    // Check userInvocable
    if (skillData.frontmatter.userInvocable === false) {
      return {
        llmContent: `Skill "${skillName}" cannot be invoked directly (userInvocable: false).`,
        returnDisplay: `Skill "${skillName}" cannot be invoked directly.`,
      };
    }

    try {
      // Parse arguments
      const argsString = params.arguments || '';
      const args = parseArguments(argsString);

      // Validate argument placeholders
      const { valid, missingIndices } = this.validateArgumentPlaceholders(
        skillData.markdown,
        args,
      );

      if (!valid) {
        return {
          llmContent: `Error: Skill "${skillName}" requires arguments at positions: ${missingIndices.join(', ')}. Please provide these arguments.`,
          returnDisplay: `Missing required arguments for skill "${skillName}".`,
        };
      }

      // Process content with substitutions and dynamic commands
      const sessionId = params._sessionId || this.config?.getSessionId?.() || '';
      const cwd = this.config?.getWorkingDir?.() || process.cwd();

      let content = skillData.markdown;

      // Apply argument substitutions
      content = substituteArguments(content, args, sessionId);

      // Process dynamic commands if present
      if (hasDynamicCommands(content)) {
        content = await processDynamicCommands(content, cwd, signal);
      }

      // Return the processed content
      const displayName = skillData.frontmatter.name || skillName;

      return {
        llmContent: content,
        returnDisplay: `Executed skill: ${displayName}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        llmContent: `Error executing skill "${skillName}": ${errorMessage}`,
        returnDisplay: `Error executing skill ${skillName}.`,
      };
    }
  }

  /**
   * Validate argument placeholders in content against provided args
   */
  private validateArgumentPlaceholders(
    content: string,
    args: string[],
  ): { valid: boolean; missingIndices: number[] } {
    const missingIndices: number[] = [];

    // Find all $ARGUMENTS[N] and $N patterns (1-based indexing)
    const pattern = /\$(?:ARGUMENTS\[)?(\d+)\]?/g;
    let match: RegExpExecArray | null;

    while ((match = pattern.exec(content)) !== null) {
      const index = parseInt(match[1], 10); // 1-based index
      if (index > args.length) {
        missingIndices.push(index);
      }
    }

    return {
      valid: missingIndices.length === 0,
      missingIndices,
    };
  }
}