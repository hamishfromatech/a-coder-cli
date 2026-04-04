/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Skill } from './types.js';

/**
 * Slash command interface (matches CLI's SlashCommand)
 * Follows Claude Code command development specification
 */
export interface SlashCommand {
  /** Command name (matches skill name) */
  name: string;
  /** Description shown in help menu */
  description?: string;
  /** Argument hint for autocomplete display */
  argumentHint?: string;
  /** Allowed tools for this command */
  allowedTools?: string[];
  /** Model override for command execution */
  model?: string;
  /** Keywords for fuzzy search */
  keywords?: string[];
  /** The action to execute */
  action: (
    context: any,
    args: string,
  ) => any;
}

/**
 * Generate slash commands from an array of skills
 *
 * Only generates commands for user-invocable skills
 *
 * @param skills - Array of skills to convert to slash commands
 * @returns Array of slash commands
 */
export function generateSlashCommands(skills: Skill[]): SlashCommand[] {
  const commands: SlashCommand[] = [];
  const seenNames = new Set<string>();

  for (const skill of skills) {
    // Skip skills that are not user-invocable
    if (skill.frontmatter.userInvocable === false) {
      continue;
    }

    // Skip duplicate skill names (keep first occurrence)
    if (seenNames.has(skill.name)) {
      continue;
    }
    seenNames.add(skill.name);

    const command = createSkillCommand(skill);
    commands.push(command);
  }

  return commands;
}

/**
 * Create a slash command from a single skill
 *
 * @param skill - The skill to convert to a slash command
 * @returns A slash command object
 */
export function createSkillCommand(skill: Skill): SlashCommand {
  const command: SlashCommand = {
    name: skill.name,
    description: skill.description,
    argumentHint: skill.frontmatter.argumentHint,
    model: skill.frontmatter.model,
    keywords: [skill.name], // Add skill name for fuzzy search
    action: async (context: any, args: string) => {
      return {
        type: 'tool',
        toolName: 'skills',
        toolArgs: {
          action: 'execute',
          skill_name: skill.name,
          arguments: args,
          // Internal parameters
          _sessionId: context?.services?.config?.getSessionId?.(),
          _currentPath: context?.services?.config?.getWorkingDir?.(),
        },
      };
    },
  };

  return command;
}

/**
 * Filter skills to only those that should generate slash commands
 *
 * @param skills - Array of all skills
 * @returns Filtered array of skills suitable for slash commands
 */
export function filterSlashCommandSkills(skills: Skill[]): Skill[] {
  return skills.filter(
    (skill) => skill.frontmatter.userInvocable !== false,
  );
}