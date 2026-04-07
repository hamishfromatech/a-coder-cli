/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { SlashCommand, CommandCategory, CommandContext } from './types.js';

interface TerminalSetupConfig {
  name: string;
  description: string;
  keybinding: string;
  keybindingMac?: string;
  editorConfig?: string;
}

const TERMINAL_SETUPS: Record<string, TerminalSetupConfig> = {
  vscode: {
    name: 'VS Code',
    description: 'Visual Studio Code integrated terminal',
    keybinding: 'Ctrl+Shift+`',
    keybindingMac: 'Cmd+Shift+`',
    editorConfig: `{
  "terminal.integrated.commandsToSkipShell": [
    "-workbench.action.quickOpen"
  ],
  "terminal.integrated.sendKeybindingsToShell": true
}`,
  },
  cursor: {
    name: 'Cursor',
    description: 'Cursor IDE integrated terminal',
    keybinding: 'Ctrl+Shift+`',
    keybindingMac: 'Cmd+Shift+`',
    editorConfig: `{
  "terminal.integrated.commandsToSkipShell": [
    "-workbench.action.quickOpen"
  ],
  "terminal.integrated.sendKeybindingsToShell": true
}`,
  },
  windsurf: {
    name: 'Windsurf',
    description: 'Windsurf IDE integrated terminal',
    keybinding: 'Ctrl+Shift+`',
    keybindingMac: 'Cmd+Shift+`',
    editorConfig: `{
  "terminal.integrated.commandsToSkipShell": [
    "-workbench.action.quickOpen"
  ],
  "terminal.integrated.sendKeybindingsToShell": true
}`,
  },
  terminal: {
    name: 'Terminal (macOS)',
    description: 'macOS Terminal.app',
    keybinding: 'Cmd+V',
  },
  iterm: {
    name: 'iTerm2',
    description: 'iTerm2 for macOS',
    keybinding: 'Cmd+V',
    keybindingMac: 'Cmd+V',
  },
  alacritty: {
    name: 'Alacritty',
    description: 'Alacritty terminal emulator',
    keybinding: 'Ctrl+Shift+V',
  },
  kitty: {
    name: 'Kitty',
    description: 'Kitty terminal emulator',
    keybinding: 'Ctrl+Shift+V',
  },
  wezterm: {
    name: 'WezTerm',
    description: 'WezTerm terminal emulator',
    keybinding: 'Ctrl+Shift+V',
  },
};

export const terminalSetupCommand: SlashCommand = {
  name: 'terminal-setup',
  description: 'Configure terminal keybindings for multiline input (VS Code, Cursor, Windsurf, etc.)',
  category: 'config' as CommandCategory,
  keywords: ['terminal', 'keybindings', 'paste', 'multiline', 'vscode', 'cursor', 'windsurf', 'settings'],
  subCommands: Object.entries(TERMINAL_SETUPS).map(([key, config]) => ({
    name: key,
    description: `${config.name} - ${config.description}`,
  })),
  action: (context: CommandContext, args: string): void => {
    const { ui } = context;
    const trimmedArgs = args.trim().toLowerCase();

    // If no args, show help
    if (!trimmedArgs) {
      const lines = [
        '🖥️  **Terminal Setup**',
        '',
        'Configure keybindings for proper multiline paste support.',
        '',
        '**Supported terminals:**',
        ...Object.entries(TERMINAL_SETUPS).map(([key, config]) => {
          const kb = config.keybindingMac ? `${config.keybindingMac} (Mac) / ${config.keybinding} (Win/Linux)` : config.keybinding;
          return `  **/${key}** - ${config.name}: \`${kb}\` for paste`;
        }),
        '',
        '**Usage:**',
        '  `/terminal-setup <terminal-name>`',
        '',
        '**Common Issues:**',
        '• Multi-line pastes submit immediately instead of inserting newlines',
        '• Bracketed paste mode not enabled in terminal',
        '• Terminal intercepting certain key combinations',
        '',
        '**Recommended settings:**',
      ];

      // Add editor-specific settings if available
      const vscode = TERMINAL_SETUPS.vscode;
      if (vscode.editorConfig) {
        lines.push(
          '',
          '**VS Code / Cursor / Windsurf**',
          'Add to `.vscode/settings.json` or user settings:',
          '```json',
          vscode.editorConfig,
          '```',
        );
      }

      lines.push(
        '',
        '**Troubleshooting:**',
        '1. Ensure bracketed paste mode is enabled in your terminal',
        '2. Use Ctrl+Enter or Cmd+Enter to submit multiline input',
        '3. Try the terminal-specific paste shortcut shown above',
      );

      ui.addItem({
        type: 'info',
        text: lines.join('\n'),
      }, Date.now());
      return;
    }

    // Find the requested terminal config
    const config = TERMINAL_SETUPS[trimmedArgs];
    if (!config) {
      const available = Object.keys(TERMINAL_SETUPS).join(', ');
      ui.addItem({
        type: 'error',
        text: `Unknown terminal: "${trimmedArgs}". Available: ${available}`,
      }, Date.now());
      return;
    }

    // Show specific terminal setup
    const lines: string[] = [
      `🖥️  **${config.name} Setup**`,
      '',
      `**${config.description}**`,
      '',
      '**Paste shortcut:**',
      config.keybindingMac
        ? `• macOS: ${config.keybindingMac}`
        : `• ${config.keybinding}`,
    ];

    if (config.keybindingMac && config.keybinding !== config.keybindingMac) {
      lines.push(`• Windows/Linux: ${config.keybinding}`);
    }

    lines.push(
      '',
      '**Instructions:**',
      '1. Use the paste shortcut above to paste multiline text',
      '2. Press Ctrl+Enter (or Cmd+Enter on Mac) to submit',
      '3. The input will preserve newlines and not submit prematurely',
    );

    if (config.editorConfig) {
      lines.push(
        '',
        '**Additional Settings:**',
        'Add to your editor settings:',
        '```json',
        config.editorConfig,
        '```',
      );
    }

    lines.push(
      '',
      '**Testing:**',
      'Try pasting the following text:',
      '```',
      'line 1',
      'line 2',
      'line 3',
      '```',
      'It should appear as multiline input without submitting.',
    );

    ui.addItem({
      type: 'info',
      text: lines.join('\n'),
    }, Date.now());
  },
};
