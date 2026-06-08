/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { themeManager } from './themes/theme-manager.js';
import { ColorsTheme, SemanticColors } from './themes/theme.js';

/**
 * Semantic color aliases for consistent UI styling.
 * Use these instead of direct accent colors for better theme support.
 */
export const Semantic: SemanticColors = {
  get Success() {
    return themeManager.getActiveTheme().colors.semantic.Success;
  },
  get Warning() {
    return themeManager.getActiveTheme().colors.semantic.Warning;
  },
  get Error() {
    return themeManager.getActiveTheme().colors.semantic.Error;
  },
  get Info() {
    return themeManager.getActiveTheme().colors.semantic.Info;
  },
  get Primary() {
    return themeManager.getActiveTheme().colors.semantic.Primary;
  },
  get Secondary() {
    return themeManager.getActiveTheme().colors.semantic.Secondary;
  },
  get Muted() {
    return themeManager.getActiveTheme().colors.semantic.Muted;
  },
};

/**
 * Returns 'black' or 'white' based on the luminance of a background color
 * for maximum contrast. Works with hex colors and Ink named colors.
 */
function getLuminance(hex: string): number {
  const shorthand = hex.length === 4 && hex.startsWith('#');
  const full = shorthand
    ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
    : hex;
  const r = parseInt(full.slice(1, 3), 16) / 255;
  const g = parseInt(full.slice(3, 5), 16) / 255;
  const b = parseInt(full.slice(5, 7), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

function isNamedDarkColor(name: string): boolean {
  const dark = new Set(['black', 'blue', 'magenta', 'red', 'gray', 'grey']);
  return dark.has(name.toLowerCase());
}

export function contrastText(bgColor: string): 'black' | 'white' {
  if (bgColor.startsWith('#')) {
    return getLuminance(bgColor) > 0.5 ? 'black' : 'white';
  }
  return isNamedDarkColor(bgColor) ? 'white' : 'black';
}

export const Colors: ColorsTheme = {
  get type() {
    return themeManager.getActiveTheme().colors.type;
  },
  get Foreground() {
    return themeManager.getActiveTheme().colors.Foreground;
  },
  get Background() {
    return themeManager.getActiveTheme().colors.Background;
  },
  get LightBlue() {
    return themeManager.getActiveTheme().colors.LightBlue;
  },
  get AccentBlue() {
    return themeManager.getActiveTheme().colors.AccentBlue;
  },
  get AccentPurple() {
    return themeManager.getActiveTheme().colors.AccentPurple;
  },
  get AccentCyan() {
    return themeManager.getActiveTheme().colors.AccentCyan;
  },
  get AccentGreen() {
    return themeManager.getActiveTheme().colors.AccentGreen;
  },
  get AccentYellow() {
    return themeManager.getActiveTheme().colors.AccentYellow;
  },
  get AccentRed() {
    return themeManager.getActiveTheme().colors.AccentRed;
  },
  get Comment() {
    return themeManager.getActiveTheme().colors.Comment;
  },
  get Gray() {
    return themeManager.getActiveTheme().colors.Gray;
  },
  get GradientColors() {
    return themeManager.getActiveTheme().colors.GradientColors;
  },
  get semantic() {
    return themeManager.getActiveTheme().colors.semantic;
  },
};
