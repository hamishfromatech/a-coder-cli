/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import matter from 'gray-matter';
import { SkillFrontmatter, SkillHooks } from './types.js';

/**
 * Parse YAML frontmatter from markdown content
 *
 * @param content - The full markdown content including frontmatter
 * @returns Object with parsed frontmatter and remaining content
 */
export function parseFrontmatter(content: string): {
  frontmatter: SkillFrontmatter;
  content: string;
} {
  const parsed = matter(content);

  // Extract and validate hook definitions
  let hooks: SkillHooks | undefined;
  if (parsed.data.hooks) {
    hooks = {
      onLoad: parsed.data.hooks.onLoad as string | undefined,
      onActivate: parsed.data.hooks.onActivate as string | undefined,
      onDeactivate: parsed.data.hooks.onDeactivate as string | undefined,
      onUnload: parsed.data.hooks.onUnload as string | undefined,
    };
  }

  const frontmatter: SkillFrontmatter = {
    name: parsed.data.name as string | undefined,
    description: parsed.data.description as string | undefined,
    argumentHint: parsed.data.argumentHint as string | undefined,
    disableModelInvocation: parsed.data.disableModelInvocation as
      | boolean
      | undefined,
    userInvocable: parsed.data.userInvocable as boolean | undefined,
    allowedTools: parsed.data.allowedTools as string[] | undefined,
    model: parsed.data.model as string | undefined,
    context: parsed.data.context as 'inline' | 'fork' | undefined,
    agent: parsed.data.agent as string | undefined,
    hooks,
  };

  // Validate the frontmatter
  validateFrontmatter(frontmatter);

  return {
    frontmatter,
    content: parsed.content,
  };
}

/**
 * Validate frontmatter fields and provide defaults
 *
 * @param frontmatter - The parsed frontmatter to validate
 * @returns Validated frontmatter with defaults applied
 */
export function validateFrontmatter(frontmatter: any): SkillFrontmatter {
  const validated: SkillFrontmatter = { ...frontmatter };

  // Apply defaults
  if (validated.userInvocable === undefined) {
    validated.userInvocable = true;
  }

  if (validated.disableModelInvocation === undefined) {
    validated.disableModelInvocation = false;
  }

  // Validate context field
  if (validated.context && !['inline', 'fork'].includes(validated.context)) {
    validated.context = 'inline';
  }

  // Validate allowedTools is an array if present
  if (validated.allowedTools && !Array.isArray(validated.allowedTools)) {
    validated.allowedTools = undefined;
  }

  return validated;
}

/**
 * Extract description from skill content if no frontmatter description exists
 *
 * @param content - The skill content (after frontmatter)
 * @returns First paragraph or line as description
 */
export function extractDescriptionFromContent(content: string): string {
  // Remove leading/trailing whitespace
  const trimmed = content.trim();

  // Try to find first paragraph (text followed by blank line)
  const firstParagraphMatch = trimmed.match(/^([^\n]+)\n\n/);
  if (firstParagraphMatch) {
    return firstParagraphMatch[1].trim();
  }

  // Fallback to first line
  const firstLine = trimmed.split('\n')[0];
  return firstLine.trim();
}