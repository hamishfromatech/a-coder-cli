/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { Colors } from '../colors.js';
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
  general: { label: 'General', color: Colors.Foreground },
  agent: { label: 'Agents', color: Colors.AccentPurple },
  skill: { label: 'Skills', color: Colors.AccentGreen },
  plugin: { label: 'Plugins', color: Colors.AccentYellow },
  session: { label: 'Session', color: Colors.AccentBlue },
  config: { label: 'Configuration', color: Colors.Gray },
  memory: { label: 'Memory', color: Colors.AccentCyan },
  advanced: { label: 'Advanced', color: Colors.Foreground },
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
          <Text color={Colors.Gray}> (or /{command.altName})</Text>
        )}
        {command.description && (
          <Text color={Colors.Gray}> - {command.description}</Text>
        )}
      </Text>

      {/* Show argument hint if available */}
      {command.argumentHint && (
        <Text color={Colors.AccentCyan} dimColor>
          {indentStr}  Usage: /{command.name}{' '}
          {typeof command.argumentHint === 'string'
            ? command.argumentHint
            : command.argumentHint
                .map((arg) =>
                  arg.required ? `<${arg.name}>` : `[${arg.name}]`,
                )
                .join(' ')}
        </Text>
      )}

      {/* Show examples if available */}
      {command.examples && command.examples.length > 0 && (
        <Text color={Colors.Gray} dimColor>
          {indentStr}  Example: {command.examples[0]}
        </Text>
      )}

      {/* Render sub-commands */}
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
      borderColor={Colors.Gray}
      borderStyle="single"
      padding={1}
    >
      {/* Title */}
      <Text bold color={Colors.AccentPurple}>
        a-coder-cli Help
      </Text>
      <Box height={1} />

      {/* Basics Section */}
      <Text bold color={Colors.Foreground}>
        📖 Basics
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>
          @
        </Text>{' '}
        - Add file context (e.g.,{' '}
        <Text bold color={Colors.AccentPurple}>
          @src/myFile.ts
        </Text>
        )
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>
          !
        </Text>{' '}
        - Execute shell commands (e.g.,{' '}
        <Text bold color={Colors.AccentPurple}>
          !npm run start
        </Text>
        )
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>
          ?
        </Text>{' '}
        - Show/hide this help
      </Text>

      <Box height={1} />

      {/* Commands Section - Grouped by Category */}
      <Text bold color={Colors.Foreground}>
        Commands
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

      {/* Shell command */}
      <Box flexDirection="column" marginTop={1}>
        <Text bold color={Colors.Foreground}>
          Shell
        </Text>
        <Text color={Colors.Foreground}>
          <Text bold color={Colors.AccentPurple}>
            {' '}
            !{' '}
          </Text>
          - Execute a shell command
        </Text>
      </Box>

      <Box height={1} />

      {/* Keyboard Shortcuts Section */}
      <Text bold color={Colors.Foreground}>
        Keyboard Shortcuts
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>
          Enter
        </Text>{' '}
        - Send message
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>
          {process.platform === 'win32' ? 'Ctrl+Enter' : 'Ctrl+J'}
        </Text>{' '}
        {process.platform === 'linux'
          ? '- New line (Alt+Enter for some distros)'
          : '- New line'}
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>
          Up/Down
        </Text>{' '}
        - History navigation / suggestion navigation
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>
          Tab
        </Text>{' '}
        - Accept suggestion
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>
          Esc
        </Text>{' '}
        - Cancel / close suggestions
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>
          Ctrl+L
        </Text>{' '}
        - Clear screen
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>
          Ctrl+C
        </Text>{' '}
        - Quit application
      </Text>

      <Box height={1} />

      {/* Agents Section */}
      <Text bold color={Colors.Foreground}>
        Custom Agents
      </Text>
      <Text color={Colors.Gray}>
        Create custom agents for specialized tasks:
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>
          {' '}
          /agent create
        </Text>{' '}
        - Create a new custom agent
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>
          {' '}
          /agent list
        </Text>{' '}
        - List all available agents
      </Text>
      <Text color={Colors.Foreground}>
        <Text bold color={Colors.AccentPurple}>
          {' '}
          /agent help
        </Text>{' '}
        - Learn more about creating agents
      </Text>

      <Box height={1} />

      {/* Tips */}
      <Text color={Colors.Gray} dimColor>
        Tip: Use fuzzy matching! Type partial command names like "ag" to match "agent"
      </Text>

      <Box height={1} />
      <Text color={Colors.Gray}>
        Press Esc or q to close
      </Text>
    </Box>
  );
};