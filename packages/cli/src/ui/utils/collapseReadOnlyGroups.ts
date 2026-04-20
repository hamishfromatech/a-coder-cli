/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { HistoryItem } from '../types.js';

/**
 * Names of read-only tools that should be collapsed when appearing consecutively.
 */
const READ_ONLY_TOOL_NAMES = new Set([
  'read_file',
  'glob',
  'grep',
  'list_directory',
  'web_fetch',
  'web_search',
]);

/**
 * Minimum number of consecutive read-only tool groups to trigger collapsing.
 * Below this threshold, items are shown individually.
 */
const COLLAPSE_THRESHOLD = 3;

/**
 * Tool name categories for better summary labels.
 * Each category has a display name and is treated as a separate
 * count in the collapsed summary.
 */
const TOOL_CATEGORIES: Record<string, { label: string; plural: string }> = {
  read_file: { label: 'Read', plural: 'files' },
  glob: { label: 'Searched', plural: 'patterns' },
  grep: { label: 'Searched', plural: 'patterns' },
  list_directory: { label: 'Listed', plural: 'directories' },
  web_fetch: { label: 'Fetched', plural: 'URLs' },
  web_search: { label: 'Searched', plural: 'queries' },
};

/**
 * Generates a short hint from a tool's description, suitable for
 * displaying alongside the collapsed summary. Shows the most recent
 * operation (e.g., "Read src/config.ts", "Searched for 'useEffect'").
 */
function generateHint(tool: { name?: string; description?: string }): string {
  const name = tool.name ?? '';
  const desc = tool.description ?? '';

  if (name === 'read_file') {
    // Extract file path from description like "Reading src/config.ts"
    const match = desc.match(/(?:Reading|Read)\s+(.+)/i);
    return match ? `Read ${match[1]}` : desc;
  }
  if (name === 'grep') {
    const match = desc.match(/(?:Searching|Searched)\s+(?:for\s+)?['"]?([^'"]+?)['"]?\s/i);
    return match ? `Searched for '${match[1]}'` : desc;
  }
  if (name === 'glob') {
    const match = desc.match(/(?:Searching|Finding)\s+(?:for\s+)?['"]?([^'"]+?)['"]?\s/i);
    return match ? `Found '${match[1]}'` : desc;
  }

  // Truncate long descriptions
  return desc.length > 60 ? desc.substring(0, 57) + '...' : desc;
}

/**
 * Collapses consecutive read-only tool groups into a single summary entry.
 * This reduces visual clutter when the AI reads many files in sequence.
 *
 * Enhanced with category-based summaries, latest operation hints,
 * and full tool name tracking for expand toggle support.
 */
export function collapseReadOnlyToolGroups(
  items: HistoryItem[],
): HistoryItem[] {
  const result: HistoryItem[] = [];
  let readBuffer: HistoryItem[] = [];

  const flushBuffer = () => {
    if (readBuffer.length === 0) return;

    if (readBuffer.length >= COLLAPSE_THRESHOLD) {
      // Collapse into a single summary entry
      const toolNames: string[] = [];
      const categoryCounts: Record<string, number> = {};
      let latestHint = '';

      for (const group of readBuffer) {
        if (group.type !== 'tool_group') continue;
        for (const tool of group.tools) {
          const name = tool.name ?? '';
          toolNames.push(name);
          const cat = TOOL_CATEGORIES[name];
          if (cat) {
            categoryCounts[name] = (categoryCounts[name] || 0) + 1;
          } else {
            // Unknown tool — use generic count
            categoryCounts[name] = (categoryCounts[name] || 0) + 1;
          }
          // Track the most recent hint (from the last tool in the last group)
          latestHint = generateHint(tool);
        }
      }

      // Build category-based summary
      const parts: string[] = [];
      for (const [toolName, count] of Object.entries(categoryCounts)) {
        const cat = TOOL_CATEGORIES[toolName];
        if (cat) {
          parts.push(`${cat.label} ${count} ${count > 1 ? cat.plural : cat.plural.replace(/s$/, '')}`);
        } else {
          const displayName = toolName.replace(/_/g, ' ');
          parts.push(count > 1 ? `${count} ${displayName}s` : displayName);
        }
      }

      const collapsedItem: HistoryItem = {
        id: readBuffer[0].id,
        type: 'collapsed_read_group',
        summary: parts.join(', '),
        toolCount: readBuffer.reduce((sum, g) => {
          if (g.type === 'tool_group') return sum + g.tools.length;
          return sum;
        }, 0),
        toolTypes: Array.from(new Set(toolNames)),
        latestHint,
        toolNames,
        isExpanded: false,
      };
      result.push(collapsedItem);
    } else {
      // Below threshold — keep individual items
      result.push(...readBuffer);
    }
    readBuffer = [];
  };

  for (const item of items) {
    if (item.type === 'tool_group') {
      const isReadOnlyGroup = item.tools.every(
        (tool) => READ_ONLY_TOOL_NAMES.has(tool.name ?? ''),
      );

      if (isReadOnlyGroup && !item.collapsible) {
        readBuffer.push(item);
        continue;
      }
    }

    // Non-read-only item or collapsible group — flush buffer and add item
    flushBuffer();
    result.push(item);
  }

  // Flush remaining buffer
  flushBuffer();

  return result;
}