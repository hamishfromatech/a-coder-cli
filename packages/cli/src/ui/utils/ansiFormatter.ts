/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import process from 'node:process';

/**
 * Detects whether the current stdout supports ANSI color output.
 * Respects NO_COLOR env var and checks TTY status.
 */
export function supportsColor(): boolean {
  if (process.env.NO_COLOR) return false;
  if (process.env.FORCE_COLOR) return true;
  return process.stdout.isTTY ?? false;
}

// ANSI escape code helpers
const CSI = '\x1b[';
const RESET = `${CSI}0m`;

function color(code: number): (text: string) => string {
  return (text: string) => `${CSI}${code}m${text}${RESET}`;
}

function bgColor(code: number): (text: string) => string {
  return (text: string) => `${CSI}${code}m${text}${CSI}49m`;
}

// --- Foreground colors (16-color) ---
export const c = {
  black:   color(30),
  red:     color(31),
  green:   color(32),
  yellow:  color(33),
  blue:    color(34),
  magenta: color(35),
  cyan:    color(36),
  white:   color(37),
  gray:    color(90),
};

// --- Background colors ---
export const bg = {
  black:   bgColor(40),
  red:     bgColor(41),
  green:   bgColor(42),
  yellow:  bgColor(43),
  blue:    bgColor(44),
  magenta: bgColor(45),
  cyan:    bgColor(46),
  white:   bgColor(47),
};

// --- Styles ---
export const bold = (text: string) => `${CSI}1m${text}${RESET}`;
export const dim  = (text: string) => `${CSI}2m${text}${RESET}`;

// --- Status symbols ---
export const sym = {
  ok:       '✓',  // ✓
  fail:     '✗',  // ✗
  pending:  '○',  // ○
  spinner:  '▸',  // ▸
  bullet:   '•',  // •
  arrow:    '→',  // →
  dash:     '─',  // ─
};

/**
 * Tool color mapping matching the interactive mode's TOOL_PILL_COLORS.
 * Maps tool names to their visual category color.
 */
const TOOL_COLORS: Record<string, { fg: (s: string) => string; bg: (s: string) => string }> = {
  // Read/search — cyan
  read_file:     { fg: c.cyan,    bg: bg.cyan },
  list_directory:{ fg: c.cyan,    bg: bg.cyan },
  glob:          { fg: c.cyan,    bg: bg.cyan },
  grep:          { fg: c.cyan,    bg: bg.cyan },
  task_list:     { fg: c.cyan,    bg: bg.cyan },
  task_get:      { fg: c.cyan,    bg: bg.cyan },
  // Write/edit — green
  write_file:    { fg: c.green,   bg: bg.green },
  edit_file:     { fg: c.green,   bg: bg.green },
  memory:        { fg: c.green,   bg: bg.green },
  write_todos:   { fg: c.green,   bg: bg.green },
  // Shell/execution — yellow
  shell:         { fg: c.yellow,  bg: bg.yellow },
  // Web/network — magenta
  web_fetch:     { fg: c.magenta, bg: bg.magenta },
  web_search:    { fg: c.magenta, bg: bg.magenta },
  skills:        { fg: c.magenta, bg: bg.magenta },
  // Agent/special — blue
  subagent:      { fg: c.blue,    bg: bg.blue },
  task_create:   { fg: c.blue,    bg: bg.blue },
  task_update:   { fg: c.blue,    bg: bg.blue },
};

const DEFAULT_TOOL_COLOR = { fg: c.white, bg: bg.black };

/**
 * Get the color pair for a tool name.
 */
export function getToolColor(name: string) {
  return TOOL_COLORS[name] ?? DEFAULT_TOOL_COLOR;
}

/**
 * Verb phrases for tools (matching interactive mode).
 */
const TOOL_VERBS: Record<string, string> = {
  read_file: 'Reading',
  list_directory: 'Listing',
  glob: 'Searching',
  grep: 'Searching',
  write_file: 'Writing',
  edit_file: 'Editing',
  shell: 'Running',
  web_fetch: 'Fetching',
  web_search: 'Searching',
  subagent: 'Thinking',
  task_create: 'Creating task',
  task_update: 'Updating task',
  task_list: 'Listing tasks',
  task_get: 'Getting task',
  skills: 'Loading skill',
  memory: 'Saving memory',
  write_todos: 'Updating todos',
  initialize_heartbeat: 'Starting heartbeat',
  exit_heartbeat: 'Stopping heartbeat',
};

/**
 * Get the verb phrase for a tool.
 */
export function getToolVerb(name: string): string {
  return TOOL_VERBS[name] ?? 'Running';
}

/**
 * Truncate a string to a maximum length, appending an ellipsis if truncated.
 */
export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 1) + '…'; // …
}

/**
 * Format tool call arguments for display.
 * Truncates long values and limits total output length.
 */
export function formatToolArgs(args: Record<string, unknown>, maxLen: number = 120): string {
  if (!args || Object.keys(args).length === 0) return '';

  const parts = Object.entries(args).map(([key, value]) => {
    if (typeof value === 'string') {
      return `${key}: "${truncate(value, 60)}"`;
    } else if (typeof value === 'object' && value !== null) {
      return `${key}: ${truncate(JSON.stringify(value), 60)}`;
    }
    return `${key}: ${value}`;
  });

  const joined = parts.join('  ');
  return truncate(joined, maxLen);
}

/**
 * Get a horizontal rule for the terminal width (or a default).
 */
export function hr(width?: number): string {
  const w = width ?? (process.stdout.columns ?? 60);
  return dim(c.gray('─'.repeat(Math.min(w, 80))));
}
