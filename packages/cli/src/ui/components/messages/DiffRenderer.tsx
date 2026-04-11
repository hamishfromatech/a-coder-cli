/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Box, Text } from 'ink';
import { diffWords } from 'diff';
import { Colors } from '../../colors.js';
import crypto from 'crypto';
import { colorizeCode } from '../../utils/CodeColorizer.js';
import { MaxSizedBox } from '../shared/MaxSizedBox.js';

interface DiffLine {
  type: 'add' | 'del' | 'context' | 'hunk' | 'other';
  oldLine?: number;
  newLine?: number;
  content: string;
}

function parseDiffWithLineNumbers(diffContent: string): DiffLine[] {
  const lines = diffContent.split('\n');
  const result: DiffLine[] = [];
  let currentOldLine = 0;
  let currentNewLine = 0;
  let inHunk = false;
  const hunkHeaderRegex = /^@@ -(\d+),?\d* \+(\d+),?\d* @@/;

  for (const line of lines) {
    const hunkMatch = line.match(hunkHeaderRegex);
    if (hunkMatch) {
      currentOldLine = parseInt(hunkMatch[1], 10);
      currentNewLine = parseInt(hunkMatch[2], 10);
      inHunk = true;
      result.push({ type: 'hunk', content: line });
      // We need to adjust the starting point because the first line number applies to the *first* actual line change/context,
      // but we increment *before* pushing that line. So decrement here.
      currentOldLine--;
      currentNewLine--;
      continue;
    }
    if (!inHunk) {
      // Skip standard Git header lines more robustly
      if (
        line.startsWith('--- ') ||
        line.startsWith('+++ ') ||
        line.startsWith('diff --git') ||
        line.startsWith('index ') ||
        line.startsWith('similarity index') ||
        line.startsWith('rename from') ||
        line.startsWith('rename to') ||
        line.startsWith('new file mode') ||
        line.startsWith('deleted file mode')
      )
        continue;
      // If it's not a hunk or header, skip (or handle as 'other' if needed)
      continue;
    }
    if (line.startsWith('+')) {
      currentNewLine++; // Increment before pushing
      result.push({
        type: 'add',
        newLine: currentNewLine,
        content: line.substring(1),
      });
    } else if (line.startsWith('-')) {
      currentOldLine++; // Increment before pushing
      result.push({
        type: 'del',
        oldLine: currentOldLine,
        content: line.substring(1),
      });
    } else if (line.startsWith(' ')) {
      currentOldLine++; // Increment before pushing
      currentNewLine++;
      result.push({
        type: 'context',
        oldLine: currentOldLine,
        newLine: currentNewLine,
        content: line.substring(1),
      });
    } else if (line.startsWith('\\')) {
      // Handle "\ No newline at end of file"
      result.push({ type: 'other', content: line });
    }
  }
  return result;
}

interface DiffRendererProps {
  diffContent: string;
  filename?: string;
  tabWidth?: number;
  availableTerminalHeight?: number;
  terminalWidth: number;
}

const DEFAULT_TAB_WIDTH = 4; // Spaces per tab for normalization

export const DiffRenderer: React.FC<DiffRendererProps> = ({
  diffContent,
  filename,
  tabWidth = DEFAULT_TAB_WIDTH,
  availableTerminalHeight,
  terminalWidth,
}) => {
  const parsedLines = React.useMemo(() => {
    if (!diffContent || typeof diffContent !== 'string') return [];
    return parseDiffWithLineNumbers(diffContent);
  }, [diffContent]);

  const key = React.useMemo(() => {
    return filename
      ? `diff-box-${filename}`
      : `diff-box-${crypto.createHash('sha1').update(JSON.stringify(parsedLines)).digest('hex')}`;
  }, [filename, parsedLines]);

  if (!diffContent || typeof diffContent !== 'string') {
    return <Text color={Colors.AccentYellow}>No diff content.</Text>;
  }

  if (parsedLines.length === 0) {
    return (
      <Box borderStyle="round" borderColor={Colors.Gray} padding={1}>
        <Text dimColor>No changes detected.</Text>
      </Box>
    );
  }

  // Check if the diff represents a new file (only additions and header lines)
  const isNewFile = parsedLines.every(
    (line) =>
      line.type === 'add' ||
      line.type === 'hunk' ||
      line.type === 'other' ||
      line.content.startsWith('diff --git') ||
      line.content.startsWith('new file mode'),
  );

  if (isNewFile) {
    // Extract only the added lines' content
    const addedContent = parsedLines
      .filter((line) => line.type === 'add')
      .map((line) => line.content)
      .join('\n');
    // Attempt to infer language from filename, default to plain text if no filename
    const fileExtension = filename?.split('.').pop() || null;
    const language = fileExtension
      ? getLanguageFromExtension(fileExtension)
      : null;
    return colorizeCode(
      addedContent,
      language,
      availableTerminalHeight,
      terminalWidth,
    );
  }

  // 1. Normalize whitespace (replace tabs with spaces) *before* further processing
  const normalizedLines = parsedLines.map((line) => ({
    ...line,
    content: line.content.replace(/\t/g, ' '.repeat(tabWidth)),
  }));

  // Filter out non-displayable lines (hunks, potentially 'other') using the normalized list
  const displayableLines = normalizedLines.filter(
    (l) => l.type !== 'hunk' && l.type !== 'other',
  );

  if (displayableLines.length === 0) {
    return (
      <Box borderStyle="round" borderColor={Colors.Gray} padding={1}>
        <Text dimColor>No changes detected.</Text>
      </Box>
    );
  }

  // Calculate the minimum indentation across all displayable lines
  let baseIndentation = Infinity; // Start high to find the minimum
  for (const line of displayableLines) {
    // Only consider lines with actual content for indentation calculation
    if (line.content.trim() === '') continue;

    const firstCharIndex = line.content.search(/\S/); // Find index of first non-whitespace char
    const currentIndent = firstCharIndex === -1 ? 0 : firstCharIndex; // Indent is 0 if no non-whitespace found
    baseIndentation = Math.min(baseIndentation, currentIndent);
  }
  // If baseIndentation remained Infinity (e.g., no displayable lines with content), default to 0
  if (!isFinite(baseIndentation)) {
    baseIndentation = 0;
  }

  // Pre-compute word-level diffs for paired del/add lines.
  // A pair is a consecutive run of `del` lines followed by an equal-length run of `add` lines.
  // For each pair index we compute diffWords between old and new content.
  interface WordDiffSegment {
    value: string;
    added?: boolean;
    removed?: boolean;
  }

  const wordDiffCache = React.useMemo(() => {
    const cache = new Map<number, WordDiffSegment[]>();
    let i = 0;
    while (i < displayableLines.length) {
      if (displayableLines[i].type !== 'del') {
        i++;
        continue;
      }
      // Gather consecutive del lines
      const delStart = i;
      while (i < displayableLines.length && displayableLines[i].type === 'del') {
        i++;
      }
      const delEnd = i; // exclusive
      // Gather consecutive add lines
      const addStart = i;
      while (i < displayableLines.length && displayableLines[i].type === 'add') {
        i++;
      }
      const addEnd = i; // exclusive
      const pairLen = Math.min(delEnd - delStart, addEnd - addStart);
      if (pairLen === 0) continue; // no matching add lines, skip
      for (let p = 0; p < pairLen; p++) {
        const delIdx = delStart + p;
        const addIdx = addStart + p;
        const oldContent = displayableLines[delIdx].content.substring(baseIndentation);
        const newContent = displayableLines[addIdx].content.substring(baseIndentation);
        if (oldContent === newContent) continue; // identical, no word diff needed
        const changes = diffWords(oldContent, newContent);
        cache.set(delIdx, changes);
        cache.set(addIdx, changes);
      }
    }
    return cache;
  }, [displayableLines, baseIndentation]);

  // Render a single line's content with word-level diff highlighting.
  // `lineType` is 'del' or 'add'; `baseColor` is 'red' or 'green'.
  // `highlightColor` is the brighter color for changed segments.
  const renderWordDiffContent = (
    content: string,
    lineType: 'del' | 'add',
    baseColor: string,
    highlightColor: string,
    segments: WordDiffSegment[],
  ): React.ReactNode => {
    const isDel = lineType === 'del';
    const nodes: React.ReactNode[] = [];
    for (const seg of segments) {
      const isChanged = isDel ? !!seg.removed : !!seg.added;
      if (isChanged) {
        nodes.push(
          <Text key={nodes.length} color={highlightColor} bold wrap="wrap">
            {seg.value}
          </Text>,
        );
      } else {
        nodes.push(
          <Text key={nodes.length} color={baseColor} wrap="wrap">
            {seg.value}
          </Text>,
        );
      }
    }
    return <>{nodes}</>;
  };

  let lastLineNumber: number | null = null;
  const MAX_CONTEXT_LINES_WITHOUT_GAP = 5;

  return (
    <MaxSizedBox
      maxHeight={availableTerminalHeight}
      maxWidth={terminalWidth}
      key={key}
    >
      {displayableLines.reduce<React.ReactNode[]>((acc, line, index) => {
        // Determine the relevant line number for gap calculation based on type
        let relevantLineNumberForGapCalc: number | null = null;
        if (line.type === 'add' || line.type === 'context') {
          relevantLineNumberForGapCalc = line.newLine ?? null;
        } else if (line.type === 'del') {
          // For deletions, the gap is typically in relation to the original file's line numbering
          relevantLineNumberForGapCalc = line.oldLine ?? null;
        }

        if (
          lastLineNumber !== null &&
          relevantLineNumberForGapCalc !== null &&
          relevantLineNumberForGapCalc >
            lastLineNumber + MAX_CONTEXT_LINES_WITHOUT_GAP + 1
        ) {
          acc.push(
            <Box key={`gap-${index}`}>
              <Text wrap="truncate">{'═'.repeat(terminalWidth)}</Text>
            </Box>,
          );
        }

        const lineKey = `diff-line-${index}`;
        let gutterNumStr = '';
        let color: string | undefined = undefined;
        let prefixSymbol = ' ';
        let dim = false;

        switch (line.type) {
          case 'add':
            gutterNumStr = (line.newLine ?? '').toString();
            color = 'green';
            prefixSymbol = '+';
            lastLineNumber = line.newLine ?? null;
            break;
          case 'del':
            gutterNumStr = (line.oldLine ?? '').toString();
            color = 'red';
            prefixSymbol = '-';
            // For deletions, update lastLineNumber based on oldLine if it's advancing.
            // This helps manage gaps correctly if there are multiple consecutive deletions
            // or if a deletion is followed by a context line far away in the original file.
            if (line.oldLine !== undefined) {
              lastLineNumber = line.oldLine;
            }
            break;
          case 'context':
            gutterNumStr = (line.newLine ?? '').toString();
            dim = true;
            prefixSymbol = ' ';
            lastLineNumber = line.newLine ?? null;
            break;
          default:
            return acc;
        }

        const displayContent = line.content.substring(baseIndentation);

        // Check if this line has word-level diff data
        const wordSegments = wordDiffCache.get(index);

        // Determine highlight colors for word-level diffs
        const highlightColor =
          line.type === 'del' ? Colors.AccentRed : Colors.AccentGreen;

        let contentNode: React.ReactNode;
        if (wordSegments && !dim && (line.type === 'del' || line.type === 'add')) {
          contentNode = renderWordDiffContent(
            displayContent,
            line.type,
            color!,
            highlightColor,
            wordSegments,
          );
        } else {
          contentNode = (
            <Text color={color} dimColor={dim} wrap="wrap">
              {displayContent}
            </Text>
          );
        }

        acc.push(
          <Box key={lineKey} flexDirection="row">
            <Text color={Colors.Gray}>{gutterNumStr.padEnd(4)} </Text>
            <Text color={color} dimColor={dim}>
              {prefixSymbol}{' '}
            </Text>
            {contentNode}
          </Box>,
        );
        return acc;
      }, [])}
    </MaxSizedBox>
  );
};

const getLanguageFromExtension = (extension: string): string | null => {
  const languageMap: { [key: string]: string } = {
    js: 'javascript',
    ts: 'typescript',
    py: 'python',
    json: 'json',
    css: 'css',
    html: 'html',
    sh: 'bash',
    md: 'markdown',
    yaml: 'yaml',
    yml: 'yaml',
    txt: 'plaintext',
    java: 'java',
    c: 'c',
    cpp: 'cpp',
    rb: 'ruby',
  };
  return languageMap[extension] || null; // Return null if extension not found
};
