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

export interface SkillsToolParams {
  action: 'list' | 'load';
  skill_name?: string;
}

export const getSkillsDir = () => path.join(os.homedir(), GEMINI_DIR, 'skills');

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

export class SkillsTool extends BaseTool<SkillsToolParams, ToolResult> {
  static readonly Name: string = 'skills';
  private readonly skillsDir: string;

  constructor() {
    super(
      SkillsTool.Name,
      'Skills',
      'Manage and load specialized skills to enhance capabilities. Use "list" to see available skills and "load" to activate a skill.',
      {
        properties: {
          action: {
            type: Type.STRING,
            enum: ['list', 'load'],
            description:
              'The action to perform: "list" to show available skills, "load" to activate a skill.',
          },
          skill_name: {
            type: Type.STRING,
            description:
              'The name of the skill to load (required if action is "load").',
          },
        },
        required: ['action'],
        type: Type.OBJECT,
      },
    );
    this.skillsDir = getSkillsDir();
  }

  validateToolParams(params: SkillsToolParams): string | null {
    const errors = SchemaValidator.validate(this.schema.parameters, params);
    if (errors) {
      return errors;
    }
    if (params.action === 'load' && !params.skill_name) {
      return 'The "skill_name" parameter is required when action is "load".';
    }
    return null;
  }

  async execute(
    params: SkillsToolParams,
    _signal: AbortSignal,
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
      try {
        const skills = getAvailableSkills();

        if (skills.length === 0) {
          return {
            llmContent: `No skills found in ${this.skillsDir}.`,
            returnDisplay: `No skills found.`,
          };
        }

        const skillList = skills.join(', ');
        return {
          llmContent: `Available skills: ${skillList}`,
          returnDisplay: `Available skills: ${skillList}`,
        };
      } catch (error) {
        return {
          llmContent: `Error listing skills: ${error}`,
          returnDisplay: `Error listing skills.`,
        };
      }
    } else if (params.action === 'load') {
      const skillName = params.skill_name!;
      const skillPath = path.join(this.skillsDir, skillName, 'SKILL.md');

      if (!fs.existsSync(skillPath)) {
        // Check if user meant a directory that exists but has no SKILL.md
        if (
          fs.existsSync(path.join(this.skillsDir, skillName)) &&
          fs.statSync(path.join(this.skillsDir, skillName)).isDirectory()
        ) {
          return {
            llmContent: `Skill "${skillName}" exists but is missing SKILL.md.`,
            returnDisplay: `Skill "${skillName}" is invalid (missing SKILL.md).`,
          };
        }
        return {
          llmContent: `Skill "${skillName}" not found.`,
          returnDisplay: `Skill "${skillName}" not found.`,
        };
      }

      try {
        const content = fs.readFileSync(skillPath, 'utf-8');
        const message = `Loaded Skill: ${skillName}\n\nInstructions:\n${content}`;
        return {
          llmContent: message,
          returnDisplay: `Loaded skill: ${skillName}`,
        };
      } catch (error) {
        return {
          llmContent: `Error reading skill file: ${error}`,
          returnDisplay: `Error loading skill ${skillName}.`,
        };
      }
    }

    return {
      llmContent: 'Unknown action.',
      returnDisplay: 'Unknown action.',
    };
  }
}
