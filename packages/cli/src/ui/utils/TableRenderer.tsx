/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Text, Box } from 'ink';
import chalk from 'chalk';
import stringWidth from 'string-width';
import { cachedStringWidth } from './lineWidthCache.js';

interface TableRendererProps {
  headers: string[];
  rows: string[][];
  terminalWidth: number;
  align?: ('left' | 'center' | 'right' | null)[];
}

/**
 * Strip markdown formatting tokens to yield plain text.
 */
function stripMarkdown(text: string): string {
  return text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*(.*?)\*/g, '$1')
    .replace(/_(.*?)_/g, '$1')
    .replace(/~~(.*?)~~/g, '$1')
    .replace(/`(.*?)`/g, '$1')
    .replace(/<u>(.*?)<\/u>/g, '$1')
    .replace(/\[(.*?)\]\(.*?\)/g, '$1');
}

/**
 * Visually truncate a plain-text string to fit within `maxDisplayWidth`.
 * Appends "…" when truncation occurs (requires ≥ 4 display columns).
 */
function truncateToWidth(text: string, maxDisplayWidth: number): string {
  const w = cachedStringWidth(text);
  if (w <= maxDisplayWidth) return text;

  if (maxDisplayWidth <= 1) return maxDisplayWidth === 1 ? '…' : '';

  // Reserve one column for the ellipsis character
  const budget = maxDisplayWidth - 1;
  let lo = 0;
  let hi = text.length;
  let best = '';
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (cachedStringWidth(text.substring(0, mid)) <= budget) {
      best = text.substring(0, mid);
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best + '…';
}

/**
 * Pad a plain-text string to exactly `targetWidth` display columns
 * using the specified alignment.
 */
function padToWidth(
  text: string,
  targetWidth: number,
  alignment: 'left' | 'center' | 'right' | null,
): string {
  const w = cachedStringWidth(text);
  const gap = Math.max(0, targetWidth - w);

  if (alignment === 'center') {
    const left = Math.floor(gap / 2);
    const right = gap - left;
    return ' '.repeat(left) + text + ' '.repeat(right);
  }
  if (alignment === 'right') {
    return ' '.repeat(gap) + text;
  }
  // left (default)
  return text + ' '.repeat(gap);
}

/**
 * Custom table renderer for markdown tables.
 *
 * Builds every row and border as a single string so Ink's Yoga flexbox
 * engine cannot reorder or collapse whitespace between cells.  This
 * guarantees pixel-perfect alignment between borders and content rows,
 * even when cells contain wide characters (CJK, emoji).
 */
export const TableRenderer: React.FC<TableRendererProps> = ({
  headers,
  rows,
  terminalWidth,
  align,
}) => {
  const numCols = headers.length;

  // --- 1. Determine plain-text content widths ----------------------------
  const plainHeaders = headers.map(stripMarkdown);
  const plainRows = rows.map((row) => row.map(stripMarkdown));

  const contentWidths = plainHeaders.map((header, ci) => {
    const h = cachedStringWidth(header);
    const r = Math.max(
      ...plainRows.map((row) => cachedStringWidth(row[ci] ?? '')),
      0,
    );
    return Math.max(h, r, 1); // at least 1 column wide
  });

  // --- 2. Compute final cell widths (content + 1-char pad each side) ---
  const PAD = 1;
  const cellWidths = contentWidths.map((w) => w + PAD * 2);

  const tableWidth =
    1 + cellWidths.reduce((s, w) => s + w, 0) + 1; // │ … │

  let finalCellWidths = cellWidths;
  if (tableWidth > terminalWidth && terminalWidth > numCols + 3) {
    // Scale content proportionally, re-add padding
    const totalContent = contentWidths.reduce((s, w) => s + w, 0);
    if (totalContent > 0) {
      const available = terminalWidth - numCols - 1 - PAD * 2 * numCols;
      const scaled = contentWidths.map((w) => {
        const s = Math.round((w / totalContent) * available);
        return Math.max(1, s);
      });
      finalCellWidths = scaled.map((w) => w + PAD * 2);
    }
  }

  // --- 3. String builders ------------------------------------------------

  const buildBorder = (
    left: string,
    mid: string,
    right: string,
    useAlignment = false,
  ): string => {
    const segments = finalCellWidths.map((cw, ci) => {
      const inner = cw - 2;
      if (useAlignment && align?.[ci]) {
        const a = align[ci]!;
        const l = a === 'left' || a === 'center' ? ':' : '─';
        const r = a === 'right' || a === 'center' ? ':' : '─';
        return l + '─'.repeat(Math.max(0, inner - 2)) + r;
      }
      return '─'.repeat(inner);
    });
    return left + segments.join(mid) + right;
  };

  const buildRow = (
    cells: string[],
    isHeader = false,
  ): string => {
    const parts = cells.map((raw, ci) => {
      const cw = finalCellWidths[ci] ?? 3;
      const inner = cw - PAD * 2; // usable content columns

      const plain = stripMarkdown(raw);
      const fitted = truncateToWidth(plain, inner);

      // Headers are always left-aligned visually
      const colAlign = isHeader ? null : (align?.[ci] ?? null);
      const padded = padToWidth(fitted, inner, colAlign);

      return ' '.repeat(PAD) + padded + ' '.repeat(PAD);
    });

    return '│' + parts.join('│') + '│';
  };

  // --- 4. Render ---------------------------------------------------------

  const topBorder = buildBorder('┌', '┬', '┐');
  const midBorder = buildBorder('├', '┼', '┤', true);
  const bottomBorder = buildBorder('└', '┴', '┘');

  const headerRow = buildRow(headers, true);
  const dataRows = rows.map((row) => buildRow(row, false));

  // Apply header styling via chalk (single string = no flexbox issues)
  const styledHeaderRow = chalk.bold.cyan(headerRow);

  return (
    <Box flexDirection="column" marginY={1}>
      <Text>{topBorder}</Text>
      <Text>{styledHeaderRow}</Text>
      <Text>{midBorder}</Text>
      {dataRows.map((row, i) => (
        <Text key={i}>{row}</Text>
      ))}
      <Text>{bottomBorder}</Text>
    </Box>
  );
};