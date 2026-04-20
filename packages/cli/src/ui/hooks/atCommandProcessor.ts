/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { PartListUnion, PartUnion } from '@google/genai';
import {
  Config,
  getErrorMessage,
  isNodeError,
  unescapePath,
} from '@a-coder/core';
import {
  HistoryItem,
  IndividualToolCallDisplay,
  ToolCallStatus,
} from '../types.js';
import { UseHistoryManagerReturn } from './useHistoryManager.js';

interface HandleAtCommandParams {
  query: string;
  config: Config;
  addItem: UseHistoryManagerReturn['addItem'];
  onDebugMessage: (message: string) => void;
  messageId: number;
  signal: AbortSignal;
}

interface PastedInfo {
  pasteId: number;
  lineCount: number;
}

interface HandleAtCommandResult {
  processedQuery: PartListUnion | null;
  shouldProceed: boolean;
}

interface AtCommandPart {
  type: 'text' | 'atPath';
  content: string;
}

/**
 * Parses a query string to find all '@<path>' commands and text segments.
 * Handles \ escaped spaces within paths.
 */
function parseAllAtCommands(query: string): AtCommandPart[] {
  const parts: AtCommandPart[] = [];
  let currentIndex = 0;

  while (currentIndex < query.length) {
    let atIndex = -1;
    let nextSearchIndex = currentIndex;
    // Find next unescaped '@'
    while (nextSearchIndex < query.length) {
      if (
        query[nextSearchIndex] === '@' &&
        (nextSearchIndex === 0 || query[nextSearchIndex - 1] !== '\\')
      ) {
        atIndex = nextSearchIndex;
        break;
      }
      nextSearchIndex++;
    }

    if (atIndex === -1) {
      // No more @
      if (currentIndex < query.length) {
        parts.push({ type: 'text', content: query.substring(currentIndex) });
      }
      break;
    }

    // Add text before @
    if (atIndex > currentIndex) {
      parts.push({
        type: 'text',
        content: query.substring(currentIndex, atIndex),
      });
    }

    // Parse @path
    let pathEndIndex = atIndex + 1;
    let inEscape = false;
    while (pathEndIndex < query.length) {
      const char = query[pathEndIndex];
      if (inEscape) {
        inEscape = false;
      } else if (char === '\\') {
        inEscape = true;
      } else if (/\s/.test(char)) {
        // Path ends at first whitespace not escaped
        break;
      }
      pathEndIndex++;
    }
    const rawAtPath = query.substring(atIndex, pathEndIndex);
    // unescapePath expects the @ symbol to be present, and will handle it.
    const atPath = unescapePath(rawAtPath);
    parts.push({ type: 'atPath', content: atPath });
    currentIndex = pathEndIndex;
  }
  // Filter out empty text parts that might result from consecutive @paths or leading/trailing spaces
  return parts.filter(
    (part) => !(part.type === 'text' && part.content.trim() === ''),
  );
}

/**
 * Processes user input potentially containing one or more '@<path>' commands.
 * If found, it attempts to read the specified files/directories using the
 * glob and read_file tools. The user query is modified to include resolved paths,
 * and the content of the files is appended in a structured block.
 *
 * @returns An object indicating whether the main hook should proceed with an
 *          LLM call and the processed query parts (including file content).
 */
export async function handleAtCommand({
  query,
  config,
  addItem,
  onDebugMessage,
  messageId: userMessageTimestamp,
  signal,
}: HandleAtCommandParams): Promise<HandleAtCommandResult> {
  // Extract pasteInfo if this query was from a paste operation
  const pastedInfo = (query as unknown as { pastedInfo?: PastedInfo }).pastedInfo;

  const commandParts = parseAllAtCommands(query);
  const atPathCommandParts = commandParts.filter(
    (part) => part.type === 'atPath',
  );

  if (atPathCommandParts.length === 0) {
    addItem(
      {
        type: 'user',
        text: query,
        ...(pastedInfo && { pastedInfo }),
      },
      userMessageTimestamp,
    );
    return { processedQuery: [{ text: query }], shouldProceed: true };
  }

  addItem(
    {
      type: 'user',
      text: query,
      ...(pastedInfo && { pastedInfo }),
    },
    userMessageTimestamp,
  );

  // Get centralized file discovery service
  const fileDiscovery = config.getFileService();
  const respectGitIgnore = config.getFileFilteringRespectGitIgnore();

  const filesToRead: string[] = [];
  const atPathToResolvedSpecMap = new Map<string, string>();
  const contentLabelsForDisplay: string[] = [];
  const ignoredPaths: string[] = [];

  const toolRegistry = await config.getToolRegistry();
  const readFileTool = toolRegistry.getTool('read_file');
  const globTool = toolRegistry.getTool('glob');

  if (!readFileTool) {
    addItem(
      { type: 'error', text: 'Error: read_file tool not found.' },
      userMessageTimestamp,
    );
    return { processedQuery: null, shouldProceed: false };
  }

  for (const atPathPart of atPathCommandParts) {
    const originalAtPath = atPathPart.content; // e.g., "@file.txt" or "@"

    if (originalAtPath === '@') {
      onDebugMessage(
        'Lone @ detected, will be treated as text in the modified query.',
      );
      continue;
    }

    const pathName = originalAtPath.substring(1);
    if (!pathName) {
      // This case should ideally not be hit if parseAllAtCommands ensures content after @
      // but as a safeguard:
      addItem(
        {
          type: 'error',
          text: `Error: Invalid @ command '${originalAtPath}'. No path specified.`,
        },
        userMessageTimestamp,
      );
      // Decide if this is a fatal error for the whole command or just skip this @ part
      // For now, let's be strict and fail the command if one @path is malformed.
      return { processedQuery: null, shouldProceed: false };
    }

    // Check if path should be ignored based on filtering options
    if (fileDiscovery.shouldIgnoreFile(pathName, { respectGitIgnore })) {
      const reason = respectGitIgnore ? 'git-ignored' : 'custom-ignored';
      onDebugMessage(`Path ${pathName} is ${reason} and will be skipped.`);
      ignoredPaths.push(pathName);
      continue;
    }

    let currentPathSpec = pathName;
    let resolvedSuccessfully = false;

    try {
      const absolutePath = path.resolve(config.getTargetDir(), pathName);
      const stats = await fs.stat(absolutePath);
      if (stats.isDirectory()) {
        // For directories, use glob to expand into individual files
        if (globTool) {
          try {
            const globResult = await globTool.execute(
              { pattern: `${pathName}/**`, path: config.getTargetDir() },
              signal,
            );
            if (
              globResult.llmContent &&
              typeof globResult.llmContent === 'string' &&
              !globResult.llmContent.startsWith('No files found') &&
              !globResult.llmContent.startsWith('Error:')
            ) {
              const lines = globResult.llmContent.split('\n');
              // Skip header line, collect file paths
              const dirFiles: string[] = [];
              for (let i = 1; i < lines.length; i++) {
                const filePath = lines[i].trim();
                if (filePath) {
                  const relativePath = path.relative(config.getTargetDir(), filePath);
                  dirFiles.push(relativePath);
                }
              }
              if (dirFiles.length > 0) {
                filesToRead.push(...dirFiles);
                currentPathSpec = `${pathName}/ (${dirFiles.length} files)`;
                resolvedSuccessfully = true;
              } else {
                onDebugMessage(
                  `Directory ${pathName} contained no readable files. Path will be skipped.`,
                );
              }
            } else {
              onDebugMessage(
                `Glob search for '${pathName}/**' found no files. Path ${pathName} will be skipped.`,
              );
            }
          } catch (globError) {
            console.error(
              `Error during glob search for ${pathName}: ${getErrorMessage(globError)}`,
            );
            onDebugMessage(
              `Error during glob search for ${pathName}. Path ${pathName} will be skipped.`,
            );
          }
        } else {
          onDebugMessage(
            `Glob tool not found. Directory ${pathName} cannot be expanded. Path will be skipped.`,
          );
        }
      } else {
        onDebugMessage(`Path ${pathName} resolved to file: ${currentPathSpec}`);
        filesToRead.push(currentPathSpec);
        resolvedSuccessfully = true;
      }
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        if (config.getEnableRecursiveFileSearch() && globTool) {
          onDebugMessage(
            `Path ${pathName} not found directly, attempting glob search.`,
          );
          try {
            const globResult = await globTool.execute(
              { pattern: `**/*${pathName}*`, path: config.getTargetDir() },
              signal,
            );
            if (
              globResult.llmContent &&
              typeof globResult.llmContent === 'string' &&
              !globResult.llmContent.startsWith('No files found') &&
              !globResult.llmContent.startsWith('Error:')
            ) {
              const lines = globResult.llmContent.split('\n');
              if (lines.length > 1 && lines[1]) {
                const firstMatchAbsolute = lines[1].trim();
                currentPathSpec = path.relative(
                  config.getTargetDir(),
                  firstMatchAbsolute,
                );
                onDebugMessage(
                  `Glob search for ${pathName} found ${firstMatchAbsolute}, using relative path: ${currentPathSpec}`,
                );
                filesToRead.push(currentPathSpec);
                resolvedSuccessfully = true;
              } else {
                onDebugMessage(
                  `Glob search for '**/*${pathName}*' did not return a usable path. Path ${pathName} will be skipped.`,
                );
              }
            } else {
              onDebugMessage(
                `Glob search for '**/*${pathName}*' found no files or an error. Path ${pathName} will be skipped.`,
              );
            }
          } catch (globError) {
            console.error(
              `Error during glob search for ${pathName}: ${getErrorMessage(globError)}`,
            );
            onDebugMessage(
              `Error during glob search for ${pathName}. Path ${pathName} will be skipped.`,
            );
          }
        } else {
          onDebugMessage(
            `Glob tool not found. Path ${pathName} will be skipped.`,
          );
        }
      } else {
        console.error(
          `Error stating path ${pathName}: ${getErrorMessage(error)}`,
        );
        onDebugMessage(
          `Error stating path ${pathName}. Path ${pathName} will be skipped.`,
        );
      }
    }

    if (resolvedSuccessfully) {
      atPathToResolvedSpecMap.set(originalAtPath, currentPathSpec);
      contentLabelsForDisplay.push(pathName);
    }
  }

  // Construct the initial part of the query for the LLM
  let initialQueryText = '';
  for (let i = 0; i < commandParts.length; i++) {
    const part = commandParts[i];
    if (part.type === 'text') {
      initialQueryText += part.content;
    } else {
      // type === 'atPath'
      const resolvedSpec = atPathToResolvedSpecMap.get(part.content);
      if (
        i > 0 &&
        initialQueryText.length > 0 &&
        !initialQueryText.endsWith(' ') &&
        resolvedSpec
      ) {
        // Add space if previous part was text and didn't end with space, or if previous was @path
        const prevPart = commandParts[i - 1];
        if (
          prevPart.type === 'text' ||
          (prevPart.type === 'atPath' &&
            atPathToResolvedSpecMap.has(prevPart.content))
        ) {
          initialQueryText += ' ';
        }
      }
      if (resolvedSpec) {
        initialQueryText += `@${resolvedSpec}`;
      } else {
        // If not resolved for reading (e.g. lone @ or invalid path that was skipped),
        // add the original @-string back, ensuring spacing if it's not the first element.
        if (
          i > 0 &&
          initialQueryText.length > 0 &&
          !initialQueryText.endsWith(' ') &&
          !part.content.startsWith(' ')
        ) {
          initialQueryText += ' ';
        }
        initialQueryText += part.content;
      }
    }
  }
  initialQueryText = initialQueryText.trim();

  // Inform user about ignored paths
  if (ignoredPaths.length > 0) {
    const ignoreType = respectGitIgnore ? 'git-ignored' : 'custom-ignored';
    onDebugMessage(
      `Ignored ${ignoredPaths.length} ${ignoreType} files: ${ignoredPaths.join(', ')}`,
    );
  }

  // Fallback for lone "@" or completely invalid @-commands resulting in empty initialQueryText
  if (filesToRead.length === 0) {
    onDebugMessage('No valid file paths found in @ commands to read.');
    if (initialQueryText === '@' && query.trim() === '@') {
      // If the only thing was a lone @, pass original query (which might have spaces)
      return { processedQuery: [{ text: query }], shouldProceed: true };
    } else if (!initialQueryText && query) {
      // If all @-commands were invalid and no surrounding text, pass original query
      return { processedQuery: [{ text: query }], shouldProceed: true };
    }
    // Otherwise, proceed with the (potentially modified) query text that doesn't involve file reading
    return {
      processedQuery: [{ text: initialQueryText || query }],
      shouldProceed: true,
    };
  }

  const processedQueryParts: PartUnion[] = [{ text: initialQueryText }];

  // Read all files in parallel using the read_file tool
  const readResults = await Promise.all(
    filesToRead.map(async (filePath) => {
      const absolutePath = path.resolve(config.getTargetDir(), filePath);
      try {
        const result = await readFileTool.execute(
          { absolute_path: absolutePath },
          signal,
        );
        return {
          filePath: absolutePath,
          relativePath: filePath,
          result,
        };
      } catch (error) {
        return {
          filePath: absolutePath,
          relativePath: filePath,
          error: getErrorMessage(error),
        };
      }
    }),
  );

  const toolCallDisplay: IndividualToolCallDisplay = {
    callId: `client-read-${userMessageTimestamp}`,
    name: 'ReadFile',
    description: `Reading ${filesToRead.length} file(s): ${contentLabelsForDisplay.join(', ')}`,
    status: ToolCallStatus.Success,
    resultDisplay: `Successfully read: ${contentLabelsForDisplay.join(', ')}`,
    confirmationDetails: undefined,
  };

  const successfulReads: string[] = [];
  const failedReads: string[] = [];

  processedQueryParts.push({
    text: '\n--- Content from referenced files ---',
  });

  for (const readResult of readResults) {
    if ('error' in readResult) {
      failedReads.push(readResult.relativePath);
      processedQueryParts.push({
        text: `\nError reading @${readResult.relativePath}: ${readResult.error}`,
      });
    } else if (readResult.result.llmContent) {
      const rawContent = readResult.result.llmContent;
      processedQueryParts.push({
        text: `\nContent from @${readResult.relativePath}:\n`,
      });
      if (typeof rawContent === 'string') {
        processedQueryParts.push({ text: rawContent });
      } else if (Array.isArray(rawContent)) {
        for (const part of rawContent) {
          if (typeof part === 'string') {
            processedQueryParts.push({ text: part });
          } else if ('text' in part) {
            processedQueryParts.push({ text: part.text });
          } else {
            // Non-text Part (e.g. image, PDF) — push as-is
            processedQueryParts.push(part as PartUnion);
          }
        }
      } else {
        // Single non-string Part
        processedQueryParts.push(rawContent as PartUnion);
      }
      successfulReads.push(readResult.relativePath);
    } else {
      failedReads.push(readResult.relativePath);
      processedQueryParts.push({
        text: `\nNo content returned for @${readResult.relativePath}`,
      });
    }
  }

  processedQueryParts.push({ text: '\n--- End of content ---' });

  if (failedReads.length > 0) {
    toolCallDisplay.status = successfulReads.length > 0 ? ToolCallStatus.Success : ToolCallStatus.Error;
    toolCallDisplay.resultDisplay = successfulReads.length > 0
      ? `Partially read: ${successfulReads.join(', ')}. Failed: ${failedReads.join(', ')}`
      : `Error reading files: ${failedReads.join(', ')}`;
  }

  addItem(
    { type: 'tool_group', tools: [toolCallDisplay] } as Omit<
      HistoryItem,
      'id'
    >,
    userMessageTimestamp,
  );
  return { processedQuery: processedQueryParts, shouldProceed: true };
}