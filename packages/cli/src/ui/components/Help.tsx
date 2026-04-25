/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors, Semantic } from '../colors.js';
import { SlashCommand, CommandCategory } from '../commands/types.js';

interface Help {
  commands: SlashCommand[];
  scrollOffset?: number;
  maxVisibleLines?: number;
}

/**
 * Category display configuration
 */
const CATEGORY_CONFIG: Record<CommandCategory, { label: string; color: string }> = {
  general: { label: 'General', color: Semantic.Secondary },
  agent: { label: 'Agents', color: Colors.AccentPurple },
  skill: { label: 'Skills', color: Colors.AccentGreen },
  plugin: { label: 'Plugins', color: Colors.AccentYellow },
  session: { label: 'Session', color: Colors.AccentBlue },
  config: { label: 'Configuration', color: Colors.Gray },
  memory: { label: 'Memory', color: Colors.AccentCyan },
  advanced: { label: 'Advanced', color: Semantic.Secondary },
};

/**
 * Group commands by category
 */
function groupCommandsByCategory(
  commands: SlashCommand[],
): Map<CommandCategory, SlashCommand[]> {
  const grouped = new Map<CommandCategory, SlashCommand[]>();

  for (const command of commands) {
    const category = command.category || 'general';
    if (!grouped.has(category)) {
      grouped.set(category, []);
    }
    grouped.get(category)!.push(command);
  }

  return grouped;
}

/**
 * Render a command with its description and sub-commands
 */
function renderCommand(command: SlashCommand, indent = 0): React.ReactNode {
  const indentStr = ' '.repeat(indent);

  return (
    <Box key={command.name} flexDirection="column">
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>
          {indentStr}/{command.name}
        </Text>
        {command.altName && (
          <Text color={Semantic.Muted}> (or /{command.altName})</Text>
        )}
        {command.description && (
          <Text color={Semantic.Muted}> {command.description}</Text>
        )}
      </Text>

      {command.argumentHint && (
        <Text color={Colors.AccentCyan} dimColor>
          {indentStr}  usage: /{command.name}{' '}
          {typeof command.argumentHint === 'string'
            ? command.argumentHint
            : command.argumentHint
                .map((arg) =>
                  arg.required ? `<${arg.name}>` : `[${arg.name}]`,
                )
                .join(' ')}
        </Text>
      )}

      {command.examples && command.examples.length > 0 && (
        <Text color={Semantic.Muted} dimColor>
          {indentStr}  e.g. {command.examples[0]}
        </Text>
      )}

      {command.subCommands &&
        command.subCommands.map((subCommand) =>
          renderCommand(subCommand, indent + 2),
        )}
    </Box>
  );
}

export const Help: React.FC<Help> = ({
  commands,
}) => {
  // Group commands by category
  const groupedCommands = groupCommandsByCategory(
    commands.filter((cmd) => cmd.description),
  );

  // Define category order
  const categoryOrder: CommandCategory[] = [
    'general',
    'agent',
    'skill',
    'plugin',
    'session',
    'memory',
    'config',
    'advanced',
  ];

  return (
    <Box
      flexDirection="column"
      marginBottom={1}
      borderColor={Semantic.Muted}
      borderStyle="single"
      padding={1}
    >
      {/* Title */}
      <Text bold color={Colors.AccentPurple}>
        a-coder-cli help
      </Text>
      <Box height={1} />

      {/* Basics */}
      <Text bold color={Semantic.Secondary}>
        basics
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>
          @
        </Text>{' '}
        add file context{' '}
        <Text color={Semantic.Muted}>(e.g. @src/myFile.ts)</Text>
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>
          !
        </Text>{' '}
        execute shell commands{' '}
        <Text color={Semantic.Muted}>(e.g. !npm run start)</Text>
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>
          ?
        </Text>{' '}
        show/hide this help
      </Text>

      <Box height={1} />

      {/* Commands */}
      <Text bold color={Semantic.Secondary}>
        commands
      </Text>

      {categoryOrder.map((category) => {
        const categoryCommands = groupedCommands.get(category);
        if (!categoryCommands || categoryCommands.length === 0) return null;

        const config = CATEGORY_CONFIG[category];

        return (
          <Box key={category} flexDirection="column" marginTop={1}>
            <Text bold color={config.color}>
              {config.label}
            </Text>
            {categoryCommands.map((command) => renderCommand(command))}
          </Box>
        );
      })}

      {/* Shell */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold color={Semantic.Secondary}>
          shell
        </Text>
        <Text color={Colors.Foreground}>
          <Text bold color={Colors.AccentPurple}>
            !
          </Text>{' '}
          execute a shell command
        </Text>
      </Box>

      <Box height={1} />

      {/* Keyboard Shortcuts */}
      <Text bold color={Semantic.Secondary}>
        keyboard shortcuts
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>Enter</Text> send message
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>Shift+Enter</Text> insert newline
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>Up/Down</Text> history / suggestion navigation
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>Tab</Text> accept suggestion
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>Esc</Text> cancel stream / close suggestions / exit shell
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>Ctrl+A/E</Text> start/end of line
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>Ctrl+K/U</Text> delete to end/start of line
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>Ctrl+W</Text> delete word before cursor
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>Ctrl+X</Text> open in external editor
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>Ctrl+V</Text> paste image from clipboard
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>Ctrl+L</Text> clear screen
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>Ctrl+O</Text> toggle reasoning display
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>Ctrl+T</Text> toggle tool descriptions
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>Ctrl+S</Text> show more lines
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>Ctrl+Y</Text> toggle auto-approve (yolo mode)
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>Shift+Tab</Text> toggle auto-edit mode
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>Ctrl+C/D</Text> quit (press twice)
      </Text>

      <Box height={1} />

      {/* Custom Agents */}
      <Text bold color={Semantic.Secondary}>
        custom agents
      </Text>
      <Text color={Semantic.Muted}>
        Create agents for specialized tasks
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>/agent create</Text> create a new agent
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>/agent list</Text> list available agents
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>/agent help</Text> learn more
      </Text>

      <Box height={1} />

      <Text color={Semantic.Muted} dimColor>
        fuzzy matching works -- type "ag" to match "agent"
      </Text>

      <Box height={1} />
      <Text color={Semantic.Muted}>
        press Esc or q to close
      </Text>
    </Box>
  );
};