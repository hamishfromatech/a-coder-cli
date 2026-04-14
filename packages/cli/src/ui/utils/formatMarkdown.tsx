/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Text } from 'ink';
import { marked, type Token, type Tokens } from 'marked';
import { Colors } from '../colors.js';

const EOL = '\n';

let markedConfigured = false;

export function configureMarked(): void {
  if (markedConfigured) return;
  markedConfigured = true;
  // Disable strikethrough parsing — the model often uses ~ for "approximate"
  marked.use({
    tokenizer: {
      del() {
        return undefined;
      },
    },
  });
}

type ReactNodeOrString = React.ReactNode | string;

/**
 * Formats a marked token into React elements.
 * Code block tokens are skipped here — they're rendered as React components
 * via CodeColorizer in MarkdownDisplay.tsx.
 */
export function formatToken(
  token: Token,
  listDepth = 0,
  orderedListNumber: number | null = null,
  parent: Token | null = null,
): ReactNodeOrString {
  switch (token.type) {
    case 'blockquote': {
      const inner = (token.tokens ?? [])
        .map((_) => formatToken(_, 0, null, null))
        .join('');
      const lines = inner.split(EOL);
      return (
        <>
          {lines.map((line, i) => (
            <Text key={i}>
              {line.trim() ? (
                <>
                  <Text dimColor>{'│ '}</Text>
                  <Text italic>{line}</Text>
                </>
              ) : null}
            </Text>
          ))}
        </>
      );
    }
    case 'code': {
      // Handled as React component in MarkdownDisplay
      return token.text + EOL;
    }
    case 'codespan': {
      return <Text color={Colors.AccentPurple}>{token.text}</Text>;
    }
    case 'em':
      return (
        <Text italic>
          {(token.tokens ?? []).map((_, i) => (
            <React.Fragment key={i}>
              {formatToken(_, 0, null, parent)}
            </React.Fragment>
          ))}
        </Text>
      );
    case 'strong':
      return (
        <Text bold>
          {(token.tokens ?? []).map((_, i) => (
            <React.Fragment key={i}>
              {formatToken(_, 0, null, parent)}
            </React.Fragment>
          ))}
        </Text>
      );
    case 'heading': {
      const content = (token.tokens ?? []).map((_, i) => (
        <React.Fragment key={i}>
          {formatToken(_, 0, null, null)}
        </React.Fragment>
      ));
      switch (token.depth) {
        case 1:
          return (
            <>
              <Text bold color={Colors.AccentCyan} underline>
                {content}
              </Text>
              <Text>{EOL}</Text>
            </>
          );
        case 2:
          return (
            <>
              <Text bold color={Colors.AccentBlue}>{content}</Text>
              <Text>{EOL}</Text>
            </>
          );
        default:
          return (
            <>
              <Text bold>{content}</Text>
              <Text>{EOL}</Text>
            </>
          );
      }
    }
    case 'hr':
      return <Text dimColor>{'───'}</Text>;
    case 'image':
      return <Text color={Colors.AccentBlue}>{token.href}</Text>;
    case 'link': {
      if (token.href.startsWith('mailto:')) {
        return token.href.replace(/^mailto:/, '');
      }
      const linkText = (token.tokens ?? []).map((_, i) => (
        <React.Fragment key={i}>
          {formatToken(_, 0, null, token)}
        </React.Fragment>
      ));
      return <Text color={Colors.AccentBlue}>{linkText}</Text>;
    }
    case 'list': {
      return (
        <>
          {token.items.map((_: Token, index: number) => (
            <React.Fragment key={index}>
              {formatToken(
                _,
                listDepth,
                token.ordered ? token.start + index : null,
                token,
              )}
            </React.Fragment>
          ))}
        </>
      );
    }
    case 'list_item': {
      const indent = '  '.repeat(listDepth);
      return (
        <>
          {(token.tokens ?? []).map((_, i) => (
            <React.Fragment key={i}>
              {indent}
              {formatToken(_, listDepth + 1, orderedListNumber, token)}
            </React.Fragment>
          ))}
        </>
      );
    }
    case 'paragraph':
      return (
        <>
          {(token.tokens ?? []).map((_, i) => (
            <React.Fragment key={i}>
              {formatToken(_, 0, null, null)}
            </React.Fragment>
          ))}
        </>
      );
    case 'space':
      return EOL;
    case 'br':
      return EOL;
    case 'text': {
      if (parent?.type === 'link') {
        return token.text;
      }
      if (parent?.type === 'list_item') {
        const prefix =
          orderedListNumber === null
            ? '•'
            : getListNumber(listDepth, orderedListNumber) + '.';
        const innerContent = token.tokens
          ? token.tokens.map((_, i) => (
              <React.Fragment key={i}>
                {formatToken(_, listDepth, orderedListNumber, token)}
              </React.Fragment>
            ))
          : linkifyIssueReferences(token.text);
        return (
          <>
            <Text>{prefix} </Text>
            {innerContent}
            <Text>{EOL}</Text>
          </>
        );
      }
      return linkifyIssueReferences(token.text);
    }
    case 'table': {
      // Tables are rendered as React components in MarkdownDisplay
      return '';
    }
    case 'escape':
      return token.text;
    case 'def':
    case 'del':
    case 'html':
      return '';
  }
  return '';
}

// Numbering styles for nested ordered lists
function numberToLetter(n: number): string {
  let result = '';
  while (n > 0) {
    n--;
    result = String.fromCharCode(97 + (n % 26)) + result;
    n = Math.floor(n / 26);
  }
  return result;
}

const ROMAN_VALUES: ReadonlyArray<[number, string]> = [
  [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'],
  [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'],
  [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'],
  [1, 'i'],
];

function numberToRoman(n: number): string {
  let result = '';
  for (const [value, numeral] of ROMAN_VALUES) {
    while (n >= value) {
      result += numeral;
      n -= value;
    }
  }
  return result;
}

function getListNumber(listDepth: number, orderedListNumber: number): string {
  switch (listDepth) {
    case 0:
    case 1:
      return orderedListNumber.toString();
    case 2:
      return numberToLetter(orderedListNumber);
    case 3:
      return numberToRoman(orderedListNumber);
    default:
      return orderedListNumber.toString();
  }
}

// Matches owner/repo#NNN style GitHub issue/PR references
const ISSUE_REF_PATTERN =
  /(^|[^\w./-])([A-Za-z0-9][\w-]*\/[A-Za-z0-9][\w.-]*)#(\d+)\b/g;

function linkifyIssueReferences(text: string): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  const regex = new RegExp(ISSUE_REF_PATTERN.source, ISSUE_REF_PATTERN.flags);
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    parts.push(
      <Text key={match.index} color={Colors.AccentBlue}>
        {match[2]}#{match[3]}
      </Text>,
    );
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  if (parts.length === 0) {
    return [text];
  }
  return parts;
}
