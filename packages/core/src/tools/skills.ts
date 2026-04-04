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
  SkillFrontmatterError,
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
  getACoderCliProjectSkillsDir,
} from '../skills/discovery.js';
import { SkillHookExecutor } from '../skills/hooks.js';
import { Skill, SkillSource, SkillScriptInfo, SCRIPT_INTERPRETERS, getAutoAllowedTools } from '../skills/types.js';

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
 * Get available skill names from all locations using SkillDiscovery
 *
 * Discovers skills from all locations:
 * - Personal: ~/.claude/skills/
 * - Project: .claude/skills/ and .a-coder-cli/skills/
 * - Nested: <current-path>/.claude/skills/
 * - Legacy: ~/.a-coder-cli/skills/
 *
 * @param config - Optional Config instance for skill discovery
 * @param currentPath - Optional current working path for nested skill discovery
 * @returns Array of available skill names (deduplicated by name, highest priority wins)
 */
export const getAvailableSkills = async (
  config?: any,
  currentPath?: string,
): Promise<string[]> => {
  try {
    // Use SkillDiscovery if config is provided
    if (config) {
      const { SkillDiscovery } = await import('../skills/discovery.js');
      const discovery = new SkillDiscovery(config);
      const skills = await discovery.discoverAll({
        currentPath,
        includeNested: true,
      });
      // Return unique skill names (SkillDiscovery already handles deduplication by priority)
      return [...new Set(skills.map((s) => s.name))];
    }

    // Fallback to legacy behavior if no config provided
    // This maintains backward compatibility for callers that don't have config
    const skillsDir = getLegacySkillsDir();
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
  } catch (error) {
    console.warn('Warning: Could not discover skills:', error);
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
    // a-coder-cli project skills: .a-coder-cli/skills/
    path.join(getACoderCliProjectSkillsDir(projectRoot), skillName, 'SKILL.md'),
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
    const skillDir = path.dirname(skillPath);
    const dirName = path.basename(skillDir);

    // Parse frontmatter with directory name for spec validation
    const { frontmatter, content: markdown } = parseFrontmatter(content, dirName);

    return {
      content,
      frontmatter,
      markdown,
      skillDir,
    };
  } catch (error) {
    if (error instanceof SkillFrontmatterError) {
      console.error(`Invalid skill frontmatter: ${error.message}`);
    } else {
      console.error('Error reading skill file:', error);
    }
    return null;
  }
}

/**
 * Detect scripts in a skill directory
 *
 * @param skillDir - The skill directory path
 * @param hooks - Optional hook definitions from frontmatter
 * @returns Array of detected script information
 */
export function detectSkillScripts(skillDir: string, hooks?: any): SkillScriptInfo[] {
  const scripts: SkillScriptInfo[] = [];
  const scriptsDir = path.join(skillDir, 'scripts');

  // Map hook names to script paths
  const hookScripts: Map<string, string> = new Map();
  if (hooks) {
    if (hooks.onLoad) hookScripts.set(hooks.onLoad, 'onLoad');
    if (hooks.onActivate) hookScripts.set(hooks.onActivate, 'onActivate');
    if (hooks.onDeactivate) hookScripts.set(hooks.onDeactivate, 'onDeactivate');
    if (hooks.onUnload) hookScripts.set(hooks.onUnload, 'onUnload');
  }

  // Scan scripts directory if it exists
  if (fs.existsSync(scriptsDir)) {
    try {
      const scanScriptsDir = (dir: string, relativePath = ''): void => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });

        for (const entry of entries) {
          const entryPath = path.join(dir, entry.name);
          const relativeEntryPath = path.join(relativePath, entry.name);

          if (entry.isDirectory()) {
            // Recursively scan subdirectories
            scanScriptsDir(entryPath, relativeEntryPath);
          } else if (entry.isFile()) {
            // Check if it's a script file
            const ext = path.extname(entry.name).toLowerCase();
            const interpreter = SCRIPT_INTERPRETERS[ext];

            // Get interpreter - from extension or from shebang
            let detectedInterpreter = interpreter;
            if (!detectedInterpreter) {
              // Try to detect from shebang
              try {
                const content = fs.readFileSync(entryPath, 'utf-8');
                const firstLine = content.split('\n')[0];
                if (firstLine.startsWith('#!')) {
                  const shebang = firstLine.slice(2).trim();
                  // Handle '#!/usr/bin/env python' style
                  if (shebang.startsWith('/usr/bin/env ')) {
                    detectedInterpreter = shebang.slice('/usr/bin/env '.length).split(' ')[0];
                  } else if (shebang.startsWith('/')) {
                    // Extract interpreter name from path
                    detectedInterpreter = path.basename(shebang.split(' ')[0]);
                  }
                }
              } catch {
                // Ignore read errors
              }
            }

            // Only include if it's a recognized script or referenced by hooks
            if (detectedInterpreter || ext === '' || hookScripts.has(relativeEntryPath)) {
              scripts.push({
                path: path.join('scripts', relativeEntryPath),
                absolutePath: entryPath,
                interpreter: detectedInterpreter || 'unknown',
                hook: hookScripts.get(relativeEntryPath) as any,
              });
            }
          }
        }
      };

      scanScriptsDir(scriptsDir);
    } catch (error) {
      console.warn(`Warning: Could not scan scripts directory ${scriptsDir}: ${error}`);
    }
  }

  return scripts;
}

/**
 * Format scripts information for display
 *
 * @param scripts - Array of detected scripts
 * @param skillDir - The skill directory path
 * @returns Formatted string for display
 */
export function formatScriptsInfo(scripts: SkillScriptInfo[], skillDir: string): string {
  if (scripts.length === 0) {
    return '';
  }

  const lines: string[] = ['\n\n--- Skill Scripts ---'];
  lines.push('This skill contains executable scripts that can be run:');

  for (const script of scripts) {
    const hookInfo = script.hook ? ` (hook: ${script.hook})` : '';
    lines.push(`\n- \`${script.absolutePath}\``);
    lines.push(`  Interpreter: ${script.interpreter}${hookInfo}`);
  }

  const autoAllowed = getAutoAllowedTools(scripts);
  if (autoAllowed.length > 0) {
    lines.push(`\nAuto-allowed tools: ${autoAllowed.join(', ')}`);
  }

  return lines.join('\n');
}

export class SkillsTool extends BaseTool<SkillsToolParams, ToolResult> {
  static readonly Name: string = 'skills';
  private readonly skillsDir: string;
  private readonly projectRoot: string;
  private readonly hookExecutor: SkillHookExecutor;

  constructor(private config?: any) {
    super(
      SkillsTool.Name,
      'Skills',
      'Manage and load specialized skills (custom slash commands) to enhance capabilities. Use action="list" to see available skills, action="load" to load a skill\'s instructions into context, and action="execute" to run a skill as a standalone command. Skills are defined in SKILL.md files with YAML frontmatter.',
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
    this.hookExecutor = new SkillHookExecutor();
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

  /**
   * Gets a human-readable description of the skills tool operation
   * @param params Parameters for the tool execution
   * @returns A markdown string describing what the tool will do
   */
  getDescription(params: SkillsToolParams): string {
    switch (params.action) {
      case 'list':
        return 'List available skills';
      case 'load':
        return `Load skill "${params.skill_name}"`;
      case 'execute': {
        const args = params.arguments ? ` ${params.arguments}` : '';
        return `Execute skill "${params.skill_name}"${args}`;
      }
      default:
        return `Skills ${params.action}`;
    }
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
      const skills: Map<string, { name: string; description: string; source: string; hasScripts: boolean; scriptsInfo?: string }> = new Map();

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

              // Detect scripts
              const scripts = detectSkillScripts(skillData.skillDir, skillData.frontmatter.hooks);
              const hasScripts = scripts.length > 0;

              skills.set(entry.name, {
                name: entry.name,
                description,
                source,
                hasScripts,
                scriptsInfo: hasScripts ? scripts.map(s => s.path).join(', ') : undefined,
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
      addSkillsFromDir(getACoderCliProjectSkillsDir(this.projectRoot), 'Project');
      addSkillsFromDir(getLegacySkillsDir(), 'Legacy');

      if (skills.size === 0) {
        return {
          llmContent: 'No skills found. Create skills in ~/.claude/skills/, .claude/skills/, or .a-coder-cli/skills/ directories.',
          returnDisplay: 'No skills found.',
        };
      }

      // Format output
      const skillList = Array.from(skills.values())
        .map((skill) => {
          const sourceTag = skill.source === 'Project' ? '[Project]' :
                          skill.source === 'Legacy' ? '[Legacy]' : '[Personal]';
          const scriptsTag = skill.hasScripts ? ' [has scripts]' : '';
          return `- ${skill.name} ${sourceTag}${scriptsTag}: ${skill.description}`;
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

      // Build skill object for hook execution
      const skill = this.buildSkillFromData(skillName, skillData);

      // Execute onLoad hook if defined
      const hookOutput: string[] = [];
      if (skill && skill.frontmatter.hooks?.onLoad) {
        const loadResult = await this.hookExecutor.executeHook(skill, 'onLoad', cwd, signal);
        if (!loadResult.success) {
          console.warn(`Warning: onLoad hook failed for skill "${skillName}": ${loadResult.error}`);
        } else if (loadResult.output) {
          hookOutput.push(loadResult.output);
        }
      }

      const displayName = skillData.frontmatter.name || skillName;
      let message = `Loaded Skill: ${displayName}\n\nInstructions:\n${content}`;

      // Append hook output if any
      if (hookOutput.length > 0) {
        message += `\n\n--- Hook Output ---\n${hookOutput.join('\n')}`;
      }

      // Detect and append scripts information
      const scripts = detectSkillScripts(skillData.skillDir, skillData.frontmatter.hooks);
      if (scripts.length > 0) {
        message += formatScriptsInfo(scripts, skillData.skillDir);
      }

      return {
        llmContent: message,
        returnDisplay: `✓ Loaded skill: ${displayName}`,
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

      // Build skill object for hook execution
      const skill = this.buildSkillFromData(skillName, skillData);

      // Execute onActivate hook if defined
      const hookOutput: string[] = [];
      if (skill && skill.frontmatter.hooks?.onActivate) {
        const activateResult = await this.hookExecutor.executeHook(skill, 'onActivate', cwd, signal);
        if (!activateResult.success) {
          console.warn(`Warning: onActivate hook failed for skill "${skillName}": ${activateResult.error}`);
        } else if (activateResult.output) {
          hookOutput.push(activateResult.output);
        }
      }

      // Return the processed content
      const displayName = skillData.frontmatter.name || skillName;
      let resultContent = content;

      // Append hook output if any
      if (hookOutput.length > 0) {
        resultContent += `\n\n--- Hook Output ---\n${hookOutput.join('\n')}`;
      }

      // Detect and append scripts information
      const scripts = detectSkillScripts(skillData.skillDir, skillData.frontmatter.hooks);
      if (scripts.length > 0) {
        resultContent += formatScriptsInfo(scripts, skillData.skillDir);
      }

      return {
        llmContent: resultContent,
        returnDisplay: `✓ Executed skill: ${displayName}`,
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

  /**
   * Build a Skill object from skill data for hook execution
   */
  private buildSkillFromData(
    skillName: string,
    skillData: { content: string; frontmatter: any; markdown: string; skillDir: string },
  ): Skill | null {
    try {
      return {
        id: `loaded:${skillName}`,
        name: skillData.frontmatter.name || skillName,
        description: skillData.frontmatter.description || '',
        source: SkillSource.Personal, // Default to personal for loaded skills
        frontmatter: skillData.frontmatter,
        content: skillData.markdown,
        supportingFiles: new Map(),
        skillDir: skillData.skillDir,
      };
    } catch {
      return null;
    }
  }
}