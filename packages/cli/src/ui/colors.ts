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
