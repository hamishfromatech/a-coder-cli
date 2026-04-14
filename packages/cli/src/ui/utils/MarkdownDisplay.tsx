/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useMemo } from 'react';
import { Text, Box } from 'ink';
import { marked, type Token, type Tokens } from 'marked';
import { colorizeCode } from './CodeColorizer.js';
import { TableRenderer } from './TableRenderer.js';
import {
  configureMarked,
  formatToken,
} from './formatMarkdown.js';

interface MarkdownDisplayProps {
  text: string;
  isPending: boolean;
  availableTerminalHeight?: number;
  terminalWidth: number;
}

// --- Token Cache ---
// Module-level cache — marked.lexer is the hot cost on virtual-scroll
// remounts (~3ms per message). Same content → same tokens. Keyed by
// a simple hash to avoid retaining full content strings.
const TOKEN_CACHE_MAX = 500;
const tokenCache = new Map<string, Token[]>();

// Characters that indicate markdown syntax. If none are present, skip the
// ~3ms marked.lexer call entirely — render as a single paragraph.
const MD_SYNTAX_RE = /[#*`|[>\-_~]|\n\n|^\d+\. |\n\d+\. /;
function hasMarkdownSyntax(s: string): boolean {
  return MD_SYNTAX_RE.test(s.length > 500 ? s.slice(0, 500) : s);
}

// Simple string hash for cache keys (not cryptographic)
function hashContent(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return hash.toString(36);
}

function cachedLexer(content: string): Token[] {
  // Fast path: plain text with no markdown syntax → single paragraph token
  if (!hasMarkdownSyntax(content)) {
    return [
      {
        type: 'paragraph',
        raw: content,
        text: content,
        tokens: [{ type: 'text', raw: content, text: content }],
      } as Token,
    ];
  }
  const key = hashContent(content);
  const hit = tokenCache.get(key);
  if (hit) {
    // Promote to MRU
    tokenCache.delete(key);
    tokenCache.set(key, hit);
    return hit;
  }
  const tokens = marked.lexer(content);
  if (tokenCache.size >= TOKEN_CACHE_MAX) {
    const first = tokenCache.keys().next().value;
    if (first !== undefined) tokenCache.delete(first);
  }
  tokenCache.set(key, tokens);
  return tokens;
}

// --- RenderCodeBlock (kept from original) ---

interface RenderCodeBlockProps {
  content: string[];
  lang: string | null;
  isPending: boolean;
  availableTerminalHeight?: number;
  terminalWidth: number;
}

const CODE_BLOCK_PREFIX_PADDING = 1;

const RenderCodeBlockInternal: React.FC<RenderCodeBlockProps> = ({
  content,
  lang,
  isPending,
  availableTerminalHeight,
  terminalWidth,
}) => {
  const RESERVED_LINES = 2;

  if (isPending && availableTerminalHeight !== undefined) {
    const MAX_CODE_LINES_WHEN_PENDING = Math.max(
      0,
      availableTerminalHeight - RESERVED_LINES,
    );

    if (content.length > MAX_CODE_LINES_WHEN_PENDING) {
      if (MAX_CODE_LINES_WHEN_PENDING < 1) {
        return (
          <Box paddingLeft={CODE_BLOCK_PREFIX_PADDING}>
            <Text dimColor>... code is being written ...</Text>
          </Box>
        );
      }
      const truncatedContent = content.slice(0, MAX_CODE_LINES_WHEN_PENDING);
      const colorizedTruncatedCode = colorizeCode(
        truncatedContent.join('\n'),
        lang,
        availableTerminalHeight,
        Math.max(10, terminalWidth - CODE_BLOCK_PREFIX_PADDING),
      );
      return (
        <Box paddingLeft={CODE_BLOCK_PREFIX_PADDING} flexDirection="column">
          {colorizedTruncatedCode}
          <Text dimColor>... generating more ...</Text>
        </Box>
      );
    }
  }

  const fullContent = content.join('\n');
  const colorizedCode = colorizeCode(
    fullContent,
    lang,
    availableTerminalHeight,
    Math.max(10, terminalWidth - CODE_BLOCK_PREFIX_PADDING),
  );

  return (
    <Box
      paddingLeft={CODE_BLOCK_PREFIX_PADDING}
      flexDirection="column"
      width={terminalWidth}
      flexShrink={0}
    >
      {colorizedCode}
    </Box>
  );
};

const RenderCodeBlock = React.memo(RenderCodeBlockInternal);

// --- Main MarkdownDisplay ---

const MarkdownDisplayInternal: React.FC<MarkdownDisplayProps> = ({
  text,
  isPending,
  availableTerminalHeight,
  terminalWidth,
}) => {
  const elements = useMemo(() => {
    if (!text) return [];

    configureMarked();
    const tokens = cachedLexer(text);
    const result: React.ReactNode[] = [];

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!;

      if (token.type === 'code') {
        // Render code blocks as React components (syntax highlighted)
        const codeToken = token as Tokens.Code;
        result.push(
          <RenderCodeBlock
            key={`code-${i}`}
            content={codeToken.text.split('\n')}
            lang={codeToken.lang || null}
            isPending={isPending}
            availableTerminalHeight={availableTerminalHeight}
            terminalWidth={terminalWidth}
          />,
        );
      } else if (token.type === 'table') {
        // Render tables as React components for proper flexbox layout
        const tableToken = token as Tokens.Table;
        const headers = tableToken.header.map(
          (h) => h.tokens?.map((t) => t.raw || '').join('') || '',
        );
        const rows = tableToken.rows.map((row) =>
          row.map((cell) =>
            cell.tokens?.map((t) => t.raw || '').join('') || '',
          ),
        );
        result.push(
          <TableRenderer
            key={`table-${i}`}
            headers={headers}
            rows={rows}
            terminalWidth={terminalWidth}
            align={tableToken.align}
          />,
        );
      } else {
        // All other tokens: render as React elements via formatToken
        const formatted = formatToken(token);
        // formatToken returns React elements or strings
        if (typeof formatted === 'string') {
          if (formatted.trim()) {
            result.push(
              <Text key={`block-${i}`} wrap="wrap">{formatted.trim()}</Text>,
            );
          }
        } else {
          result.push(
            <Text key={`block-${i}`} wrap="wrap">{formatted}</Text>,
          );
        }
      }
    }

    return result;
  }, [text, isPending, availableTerminalHeight, terminalWidth]);

  return <>{elements}</>;
};

export const MarkdownDisplay = React.memo(MarkdownDisplayInternal);
