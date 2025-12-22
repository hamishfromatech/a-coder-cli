/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type ColorsTheme, Theme } from './theme.js';

const ollamaDarkColors: ColorsTheme = {
  type: 'dark',
  Background: '#0b0e14',
  Foreground: '#bfbdb6',
  LightBlue: '#59C2FF',
  AccentBlue: '#39BAE6',
  AccentPurple: '#D2A6FF',
  AccentCyan: '#95E6CB',
  AccentGreen: '#AAD94C',
  AccentYellow: '#FFD700',
  AccentRed: '#F26D78',
  Comment: '#646A71',
  Gray: '#3D4149',
  GradientColors: ['#2c3e50', '#bdc3c7', '#ffffff', '#bdc3c7', '#2c3e50'],
};

export const OllamaDark: Theme = new Theme(
  'A-Coder Dark',
  'dark',
  {
    hljs: {
      display: 'block',
      overflowX: 'auto',
      padding: '0.5em',
      background: ollamaDarkColors.Background,
      color: ollamaDarkColors.Foreground,
    },
    'hljs-keyword': {
      color: ollamaDarkColors.AccentYellow,
    },
    'hljs-literal': {
      color: ollamaDarkColors.AccentPurple,
    },
    'hljs-symbol': {
      color: ollamaDarkColors.AccentCyan,
    },
    'hljs-name': {
      color: ollamaDarkColors.LightBlue,
    },
    'hljs-link': {
      color: ollamaDarkColors.AccentBlue,
    },
    'hljs-function .hljs-keyword': {
      color: ollamaDarkColors.AccentYellow,
    },
    'hljs-subst': {
      color: ollamaDarkColors.Foreground,
    },
    'hljs-string': {
      color: ollamaDarkColors.AccentGreen,
    },
    'hljs-title': {
      color: ollamaDarkColors.AccentYellow,
    },
    'hljs-type': {
      color: ollamaDarkColors.AccentBlue,
    },
    'hljs-attribute': {
      color: ollamaDarkColors.AccentYellow,
    },
    'hljs-bullet': {
      color: ollamaDarkColors.AccentYellow,
    },
    'hljs-addition': {
      color: ollamaDarkColors.AccentGreen,
    },
    'hljs-variable': {
      color: ollamaDarkColors.Foreground,
    },
    'hljs-template-tag': {
      color: ollamaDarkColors.AccentYellow,
    },
    'hljs-template-variable': {
      color: ollamaDarkColors.AccentYellow,
    },
    'hljs-comment': {
      color: ollamaDarkColors.Comment,
      fontStyle: 'italic',
    },
    'hljs-quote': {
      color: ollamaDarkColors.AccentCyan,
      fontStyle: 'italic',
    },
    'hljs-deletion': {
      color: ollamaDarkColors.AccentRed,
    },
    'hljs-meta': {
      color: ollamaDarkColors.AccentYellow,
    },
    'hljs-doctag': {
      fontWeight: 'bold',
    },
    'hljs-strong': {
      fontWeight: 'bold',
    },
    'hljs-emphasis': {
      fontStyle: 'italic',
    },
  },
  ollamaDarkColors,
);
