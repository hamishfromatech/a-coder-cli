/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Terminal-safe icon constants.
 * These icons use Unicode characters that are widely supported across terminals.
 * For terminals that don't support Unicode, ASCII fallbacks are provided.
 */

/**
 * Check if the terminal likely supports Unicode characters.
 * This is a best-effort check - some terminals may still have issues.
 */
export function supportsUnicode(): boolean {
  // Check environment variables for common terminal types
  const term = process.env.TERM || '';
  const termProgram = process.env.TERM_PROGRAM || '';
  const wtSession = process.env.WT_SESSION;
  const vscode = process.env.VSCODE_INJECTION;
  const iterm = process.env.ITERM_SESSION_ID;

  // Windows Terminal, VS Code, iTerm2, and modern terminals support Unicode
  if (wtSession || vscode || iterm) {
    return true;
  }

  // Check for known Unicode-supporting terminals
  if (
    termProgram === 'iTerm.app' ||
    termProgram === 'Terminal.app' ||
    termProgram === 'vscode' ||
    termProgram === 'WarpTerminal' ||
    term.includes('xterm') ||
    term.includes('screen') ||
    term.includes('vt100') ||
    term.includes('vt220')
  ) {
    return true;
  }

  // Default to Unicode on modern systems (most terminals support basic Unicode)
  // Platform check: Windows 10+ and modern macOS/Linux terminals support Unicode
  return true;
}

/**
 * Icon set with Unicode primary and ASCII fallback.
 */
export const Icons = {
  // Status icons
  Success: '✓',
  SuccessAscii: '[OK]',

  Error: '✕',
  ErrorAscii: '[X]',

  Warning: '⚠',
  WarningAscii: '[!]',

  Info: 'ℹ',
  InfoAscii: '[i]',

  Pending: '○',
  PendingAscii: '[ ]',

  Running: '⊷',
  RunningAscii: '>',

  Cancelled: '○',
  CancelledAscii: '[/]',

  Confirming: '?',

  // Message type icons
  Log: '›',
  LogAscii: '>',

  Debug: '🔍',
  DebugAscii: '[d]',

  // Action icons
  Update: '⬆',
  UpdateAscii: '[^]',

  Edit: '✎',
  EditAscii: '[e]',

  Delete: '✕',
  DeleteAscii: '[x]',

  // Label prefixes (for consistent message formatting)
  ErrorLabel: '[ERROR]',
  WarningLabel: '[WARN]',
  InfoLabel: '[INFO]',
  UpdateLabel: '[UPDATE]',
  DebugLabel: '[DEBUG]',
} as const;

/**
 * Get the appropriate icon for the current terminal.
 * Returns Unicode icon if supported, otherwise ASCII fallback.
 */
export function getIcon(iconType: keyof typeof Icons): string {
  const asciiKey = `${iconType}Ascii` as keyof typeof Icons;

  // Some icons don't have ASCII variants (like labels)
  if (asciiKey in Icons) {
    return supportsUnicode() ? Icons[iconType] : Icons[asciiKey];
  }

  return Icons[iconType];
}

/**
 * Get icon for status values.
 */
export function getStatusIcon(status: 'success' | 'error' | 'warning' | 'info' | 'pending' | 'running' | 'cancelled' | 'confirming'): string {
  const iconMap: Record<string, keyof typeof Icons> = {
    success: 'Success',
    error: 'Error',
    warning: 'Warning',
    info: 'Info',
    pending: 'Pending',
    running: 'Running',
    cancelled: 'Cancelled',
    confirming: 'Confirming',
  };

  const iconType = iconMap[status];
  if (iconType === 'Confirming') {
    return Icons.Confirming; // Always use ? for confirming
  }

  return getIcon(iconType);
}

/**
 * Get icon for message type.
 */
export function getMessageIcon(type: 'error' | 'warn' | 'info' | 'debug' | 'log'): string {
  const iconMap: Record<string, keyof typeof Icons> = {
    error: 'Error',
    warn: 'Warning',
    info: 'Info',
    debug: 'Debug',
    log: 'Log',
  };

  return getIcon(iconMap[type]);
}

/**
 * Get label prefix for message type.
 */
export function getMessageLabel(type: 'error' | 'warn' | 'info' | 'update' | 'debug'): string {
  const labelMap: Record<string, string> = {
    error: Icons.ErrorLabel,
    warn: Icons.WarningLabel,
    info: Icons.InfoLabel,
    update: Icons.UpdateLabel,
    debug: Icons.DebugLabel,
  };

  return labelMap[type];
}