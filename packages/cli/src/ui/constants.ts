/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

const EstimatedArtWidth = 59;
const BoxBorderWidth = 1;
export const BOX_PADDING_X = 1;

// Calculate width based on art, padding, and border
export const UI_WIDTH =
  EstimatedArtWidth + BOX_PADDING_X * 2 + BoxBorderWidth * 2; // ~63

export const STREAM_DEBOUNCE_MS = 100;

// --- Design Tokens: Spacing System ---
// Consistent spacing tokens to replace ad-hoc magic numbers.
// These values are optimized for terminal rendering (Ink flexbox).
export const SPACING = {
  /** 0 — no space */
  none: 0,
  /** 1 — minimal breathing room (inline separators, tight groups) */
  xs: 0,
  /** 1 — compact (icon-to-text gaps, inline padding) */
  sm: 1,
  /** 2 — default rhythm (between sibling sections, component margins) */
  md: 1,
  /** 1 — standard vertical margin for message blocks */
  lg: 1,
  /** 2 — generous separation (major section breaks, dialog padding) */
  xl: 2,
} as const;

// --- Design Tokens: Layout ---
export const LAYOUT = {
  /** Horizontal padding for the main content area */
  contentPaddingX: 2,
  /** Width offset for nested content (e.g., inside tool results) */
  nestIndent: 3,
  /** Maximum visible history items before archiving */
  maxVisibleHistory: 200,
  /** Minimum input field width */
  minInputWidth: 20,
  /** Anti-flicker hold time for collapsible tool groups (ms) */
  collapsibleHoldMs: 700,
  /** Terminal resize debounce (ms) */
  resizeDebounceMs: 300,
} as const;

// --- Design Tokens: Content ---
export const CONTENT = {
  /** Max characters to display for error messages */
  maxErrorLength: 1000,
  /** Max characters for error messages in verbose mode */
  maxVerboseErrorLength: 10000,
  /** Max characters to render in tool result display */
  maxToolResultCharacters: 1000000,
  /** Reserved line count for tool message chrome (name, status, padding) */
  toolReservedLines: 5,
  /** Minimum lines shown in tool result */
  minToolLinesShown: 2,
  /** Max tool arg display length */
  maxToolArgLength: 120,
  /** Per-arg max display length */
  maxToolArgItemLength: 60,
} as const;
