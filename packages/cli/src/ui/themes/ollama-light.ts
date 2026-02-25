/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type ColorsTheme, Theme } from './theme.js';

const ollamaLightColors: ColorsTheme = {
  type: 'light',
  Background: '#f8f9fa',
  Foreground: '#5c6166',
  LightBlue: '#55b4d4',
  AccentBlue: '#399ee6',
  AccentPurple: '#a37acc',
  AccentCyan: '#4cbf99',
  AccentGreen: '#86b300',
  AccentYellow: '#f2ae49',
  AccentRed: '#f07171',
  Comment: '#ABADB1',
  Gray: '#CCCFD3',
  GradientColors: ['#2c3e50', '#bdc3c7', '#ffffff', '#bdc3c7', '#2c3e50'],
  semantic: {
    Success: '#86b300',
    Warning: '#f2ae49',
    Error: '#f07171',
    Info: '#399ee6',
    Primary: '#a37acc',
    Secondary: '#787b80',
    Muted: '#ABADB1',
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
