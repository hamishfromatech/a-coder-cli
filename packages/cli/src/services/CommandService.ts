/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Config } from '@a-coder/core';
import { aboutCommand } from '../ui/commands/aboutCommand.js';
import { authCommand } from '../ui/commands/authCommand.js';
import { clearCommand } from '../ui/commands/clearCommand.js';
import { helpCommand } from '../ui/commands/helpCommand.js';
import { memoryCommand } from '../ui/commands/memoryCommand.js';
import { privacyCommand } from '../ui/commands/privacyCommand.js';
import { skillsCommand } from '../ui/commands/skillsCommand.js';
import { themeCommand } from '../ui/commands/themeCommand.js';
import { SlashCommand } from '../ui/commands/types.js';

const loadBuiltInCommands = async (): Promise<SlashCommand[]> => [
  aboutCommand,
  authCommand,
  clearCommand,
  helpCommand,
  memoryCommand,
  privacyCommand,
  skillsCommand,
  themeCommand,
];

export class CommandService {
  private commands: SlashCommand[] = [];
  private skillsLoaded = false;
  private skillRegistry: any = null;

  constructor(
    private commandLoader: () => Promise<SlashCommand[]> = loadBuiltInCommands,
  ) {
    // The constructor can be used for dependency injection in the future.
  }

  async loadCommands(config?: Config): Promise<void> {
    // Load built-in commands
    this.commands = await this.commandLoader();

    // Load skill-based commands if not loaded yet and config is provided
    if (!this.skillsLoaded && config) {
      await this.loadSkillCommands(config);
      this.skillsLoaded = true;
    }
  }

  /**
   * Load skill-based commands from discovery
   *
   * @param config - The Config instance for skill discovery
   */
  private async loadSkillCommands(config: Config): Promise<void> {
    try {
      // Import skills modules lazily to avoid circular dependencies
      const { SkillDiscovery } = await import('@a-coder/core');
      const { generateSlashCommands } = await import('@a-coder/core');

      const discovery = new SkillDiscovery(config);
      const skills = await discovery.discoverAll();

      if (skills.length === 0) {
        return;
      }

      // Create slash commands from skills
      const skillCommands = generateSlashCommands(skills);

      // Merge skill commands with built-in commands
      // Skill commands come after built-in commands for now
      this.commands = [...this.commands, ...skillCommands];

      // Store registry for potential future use
      // (e.g., for command completion, dynamic help, etc.)
      this.skillRegistry = skills;
    } catch (error) {
      console.warn('Warning: Could not load skill commands:', error);
      // Don't fail entirely if skill loading fails
    }
  }

  getCommands(): SlashCommand[] {
    return this.commands;
  }

  /**
   * Check if a command with the given name exists
   */
  hasCommand(name: string): boolean {
    return this.commands.some((cmd) => cmd.name === name);
  }

  /**
   * Get a command by name
   */
  getCommand(name: string): SlashCommand | undefined {
    return this.commands.find((cmd) => cmd.name === name);
  }
}