import React from 'react';
import { Box, Text } from 'ink';
import { Colors, Semantic } from '../colors.js';
import { SlashCommand, CommandCategory } from '../commands/types.js';
import { Divider } from './shared/Divider.js';

interface Help {
  commands: SlashCommand[];
  scrollOffset?: number;
  maxVisibleLines?: number;
}

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

function renderCommand(command: SlashCommand, indent = 0): React.ReactNode {
  const indentStr = ' '.repeat(indent);
  return (
    <Box key={command.name} flexDirection="column" marginTop={1}>
      <Box flexDirection="row" alignItems="center" gap={1}>
        <Text color={Colors.AccentPurple} bold>
          {indentStr}/{command.name}
        </Text>
        {command.altName && (
          <Text color={Semantic.Muted} dimColor>({command.altName})</Text>
        )}
        {command.description && (
          <Text color={Colors.Foreground}>{command.description}</Text>
        )}
      </Box>
      {command.argumentHint && (
        <Box marginLeft={2} marginTop={0}>
          <Text color={Colors.AccentCyan} dimColor>
            /{command.name}{' '}
            {typeof command.argumentHint === 'string'
              ? command.argumentHint
              : command.argumentHint
                  .map((arg) => arg.required ? `<${arg.name}>` : `[${arg.name}]`)
                  .join(' ')}
          </Text>
        </Box>
      )}
      {command.examples && command.examples.length > 0 && (
        <Box marginLeft={2}>
          <Text color={Semantic.Muted} dimColor>
            e.g. {command.examples[0]}
          </Text>
        </Box>
      )}
      {command.subCommands &&
        command.subCommands.map((subCommand) =>
          renderCommand(subCommand, indent + 2),
        )}
    </Box>
  );
}

export const Help: React.FC<Help> = ({ commands }) => {
  const groupedCommands = groupCommandsByCategory(
    commands.filter((cmd) => cmd.description),
  );

  const categoryOrder: CommandCategory[] = [
    'general', 'agent', 'skill', 'plugin', 'session', 'memory', 'config', 'advanced',
  ];

  return (
    <Box
      flexDirection="column"
      marginBottom={1}
      borderStyle="round"
      borderColor={Semantic.Muted}
      padding={1}
    >
      <Box flexDirection="column" gap={1}>
        {/* Basics */}
        <Box>
          <Text bold color={Colors.AccentPurple}>a-coder-cli help</Text>
        </Box>
        <Divider marginTop={0} marginBottom={0} />

        <Box flexDirection="row" gap={2} flexWrap="wrap">
          <Box>
            <Box backgroundColor={Colors.AccentPurple} paddingX={1}>
              <Text color="black" bold>@file</Text>
            </Box>
            <Text dimColor> context</Text>
          </Box>
          <Box>
            <Box backgroundColor={Semantic.Warning} paddingX={1}>
              <Text color="black" bold>!cmd</Text>
            </Box>
            <Text dimColor> shell</Text>
          </Box>
          <Box>
            <Box backgroundColor={Semantic.Muted} paddingX={1}>
              <Text color="black" bold>?</Text>
            </Box>
            <Text dimColor> help</Text>
          </Box>
        </Box>

        <Box height={1} />

        {/* Commands by category */}
        {categoryOrder.map((category) => {
          const categoryCommands = groupedCommands.get(category);
          if (!categoryCommands || categoryCommands.length === 0) return null;
          const config = CATEGORY_CONFIG[category];
          return (
            <Box key={category} flexDirection="column">
              <Text bold color={config.color}>{config.label}</Text>
              {categoryCommands.map((command) => renderCommand(command))}
            </Box>
          );
        })}

        {/* Keyboard Shortcuts */}
        <Box height={1} />
        <Text bold color={Semantic.Secondary}>keyboard shortcuts</Text>
        <Box
          flexDirection="row"
          flexWrap="wrap"
          gap={1}
          marginTop={1}
        >
          {[
            { key: 'Enter', desc: 'send' },
            { key: 'S-Enter', desc: 'newline' },
            { key: 'Up/Down', desc: 'history' },
            { key: 'Tab', desc: 'complete' },
            { key: 'Esc', desc: 'cancel' },
            { key: 'Ctrl+A/E', desc: 'line start/end' },
            { key: 'Ctrl+K/U', desc: 'delete line' },
            { key: 'Ctrl+L', desc: 'clear' },
            { key: 'Ctrl+O', desc: 'reasoning' },
            { key: 'Ctrl+T', desc: 'tool desc' },
            { key: 'Ctrl+S', desc: 'show more' },
            { key: 'Ctrl+X', desc: 'external editor' },
            { key: 'Ctrl+C/D', desc: 'quit (x2)' },
          ].map(({ key, desc }) => (
            <Box key={key} flexDirection="row" gap={0} alignItems="center">
              <Box backgroundColor={Colors.AccentPurple} paddingX={1}>
                <Text color="black" bold>{key}</Text>
              </Box>
              <Text dimColor> {desc}</Text>
            </Box>
          ))}
        </Box>
      </Box>

      <Box height={1} />
      <Divider marginTop={0} marginBottom={1} />
      <Text color={Semantic.Muted} dimColor>
        Esc or q to close | fuzzy matching supported
      </Text>
    </Box>
  );
};