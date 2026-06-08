import {
  OpenDialogActionReturn,
  MessageActionReturn,
  SlashCommand,
  CommandCategory,
  CommandContext,
} from './types.js';
import { themeManager } from '../themes/theme-manager.js';

export const themeCommand: SlashCommand = {
  name: 'theme',
  description: 'Change color theme or preview current theme',
  category: 'config' as CommandCategory,
  keywords: ['theme', 'color', 'style', 'appearance', 'dark', 'light'],
  argumentHint: [
    { name: 'name', required: false, description: 'Theme name to switch to' },
    { name: 'preview', required: false, description: 'Preview current theme colors' },
  ],
  examples: ['/theme', '/theme preview', '/theme Dracula'],
  action: (_context: CommandContext, args: string): OpenDialogActionReturn | MessageActionReturn => {
    const trimmed = args.trim();
    if (trimmed === 'preview') {
      return { type: 'dialog', dialog: 'theme-preview' };
    }
    if (trimmed) {
      const found = themeManager.findThemeByName(trimmed);
      if (found) {
        return { type: 'dialog', dialog: 'theme' };
      }
      return { type: 'message', messageType: 'info', content: `Theme "${trimmed}" not found. Use /theme to see available themes.` };
    }
    return { type: 'dialog', dialog: 'theme' };
  },
};