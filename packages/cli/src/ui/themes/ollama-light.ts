/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type ColorsTheme, Theme } from './theme.js';

const ollamaLightColors: ColorsTheme = {
  type: 'light',
  Background: '#FAFAFA',
  Foreground: '#1A1A1A',
  LightBlue: '#808080',
  AccentBlue: '#606060',
  AccentPurple: '#505050',
  AccentCyan: '#707070',
  AccentGreen: '#404040',
  AccentYellow: '#909090',
  AccentRed: '#B0B0B0',
  Comment: '#9CA3AF',
  Gray: '#D1D5DB',
  GradientColors: ['#E5E5E5', '#D4D4D4', '#A3A3A3', '#737373', '#525252'],
  semantic: {
    Success: '#505050',
    Warning: '#404040',
    Error: '#606060',
    Info: '#707070',
    Primary: '#404040',
    Secondary: '#909090',
    Muted: '#9CA3AF',
  },
};

export const OllamaLight: Theme = new Theme(
  'A-Coder Light',
  'light',
  {
    hljs: {
      display: 'block',
      overflowX: 'auto',
      padding: '0.5em',
      background: ollamaLightColors.Background,
      color: ollamaLightColors.Foreground,
    },
    'hljs-comment': {
      color: ollamaLightColors.Comment,
      fontStyle: 'italic',
    },
    'hljs-quote': {
      color: ollamaLightColors.AccentCyan,
      fontStyle: 'italic',
    },
    'hljs-string': {
      color: ollamaLightColors.AccentGreen,
    },
    'hljs-constant': {
      color: ollamaLightColors.AccentCyan,
    },
    'hljs-number': {
      color: ollamaLightColors.AccentPurple,
    },
    'hljs-keyword': {
      color: ollamaLightColors.AccentYellow,
    },
    'hljs-selector-tag': {
      color: ollamaLightColors.AccentYellow,
    },
    'hljs-attribute': {
      color: ollamaLightColors.AccentYellow,
    },
    'hljs-variable': {
      color: ollamaLightColors.Foreground,
    },
    'hljs-variable.language': {
      color: ollamaLightColors.LightBlue,
      fontStyle: 'italic',
    },
    'hljs-title': {
      color: ollamaLightColors.AccentBlue,
    },
    'hljs-section': {
      color: ollamaLightColors.AccentGreen,
      fontWeight: 'bold',
    },
    'hljs-type': {
      color: ollamaLightColors.LightBlue,
    },
    'hljs-class .hljs-title': {
      color: ollamaLightColors.AccentBlue,
    },
    'hljs-tag': {
      color: ollamaLightColors.LightBlue,
    },
    'hljs-name': {
      color: ollamaLightColors.AccentBlue,
    },
    'hljs-builtin-name': {
      color: ollamaLightColors.AccentYellow,
    },
    'hljs-meta': {
      color: ollamaLightColors.AccentYellow,
    },
    'hljs-symbol': {
      color: ollamaLightColors.AccentRed,
    },
    'hljs-bullet': {
      color: ollamaLightColors.AccentYellow,
    },
    'hljs-regexp': {
      color: ollamaLightColors.AccentCyan,
    },
    'hljs-link': {
      color: ollamaLightColors.LightBlue,
    },
    'hljs-deletion': {
      color: ollamaLightColors.AccentRed,
    },
    'hljs-addition': {
      color: ollamaLightColors.AccentGreen,
    },
    'hljs-emphasis': {
      fontStyle: 'italic',
    },
    'hljs-strong': {
      fontWeight: 'bold',
    },
    'hljs-literal': {
      color: ollamaLightColors.AccentCyan,
    },
    'hljs-built_in': {
      color: ollamaLightColors.AccentRed,
    },
    'hljs-doctag': {
      color: ollamaLightColors.AccentRed,
    },
    'hljs-template-variable': {
      color: ollamaLightColors.AccentCyan,
    },
    'hljs-selector-id': {
      color: ollamaLightColors.AccentRed,
    },
  },
  ollamaLightColors,
);
