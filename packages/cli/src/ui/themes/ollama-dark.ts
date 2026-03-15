/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { type ColorsTheme, Theme } from './theme.js';

const ollamaDarkColors: ColorsTheme = {
  type: 'dark',
  Background: '#0A0A0A',
  Foreground: '#E8E8E8',
  LightBlue: '#B0B0B0',
  AccentBlue: '#A0A0A0',
  AccentPurple: '#909090',
  AccentCyan: '#C0C0C0',
  AccentGreen: '#D0D0D0',
  AccentYellow: '#999999',
  AccentRed: '#808080',
  Comment: '#666666',
  Gray: '#3D3D3D',
  GradientColors: ['#1A1A1A', '#2A2A2A', '#3A3A3A', '#4A4A4A', '#5A5A5A'],
  semantic: {
    Success: '#B8B8B8',
    Warning: '#A0A0A0',
    Error: '#888888',
    Info: '#C8C8C8',
    Primary: '#D0D0D0',
    Secondary: '#606060',
    Muted: '#505050',
  },
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
      color: ollamaDarkColors.AccentCyan,
    },
    'hljs-literal': {
      color: ollamaDarkColors.LightBlue,
    },
    'hljs-symbol': {
      color: ollamaDarkColors.AccentCyan,
    },
    'hljs-name': {
      color: ollamaDarkColors.AccentGreen,
    },
    'hljs-link': {
      color: ollamaDarkColors.AccentBlue,
    },
    'hljs-function .hljs-keyword': {
      color: ollamaDarkColors.AccentCyan,
    },
    'hljs-subst': {
      color: ollamaDarkColors.Foreground,
    },
    'hljs-string': {
      color: ollamaDarkColors.AccentGreen,
    },
    'hljs-title': {
      color: ollamaDarkColors.AccentCyan,
    },
    'hljs-type': {
      color: ollamaDarkColors.AccentBlue,
    },
    'hljs-attribute': {
      color: ollamaDarkColors.LightBlue,
    },
    'hljs-bullet': {
      color: ollamaDarkColors.AccentCyan,
    },
    'hljs-addition': {
      color: ollamaDarkColors.semantic.Info,
    },
    'hljs-variable': {
      color: ollamaDarkColors.Foreground,
    },
    'hljs-template-tag': {
      color: ollamaDarkColors.LightBlue,
    },
    'hljs-template-variable': {
      color: ollamaDarkColors.LightBlue,
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
      color: ollamaDarkColors.AccentBlue,
    },
    'hljs-meta': {
      color: ollamaDarkColors.LightBlue,
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
