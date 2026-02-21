/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import matter from 'gray-matter';
import { SkillFrontmatter, SkillHooks } from './types.js';

/**
 * Validation error for skill frontmatter
 */
export class SkillFrontmatterError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'SkillFrontmatterError';
  }
}

/**
 * Parse YAML frontmatter from markdown content
 *
 * Follows the Agent Skills Specification from https://agentskills.io/specification
 *
 * @param content - The full markdown content including frontmatter
 * @param skillDirName - Optional directory name for name validation
 * @returns Object with parsed frontmatter and remaining content
 * @throws SkillFrontmatterError if required fields are missing or invalid
 */
export function parseFrontmatter(
  content: string,
  skillDirName?: string,
): {
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

  // Handle allowed-tools (spec format) vs allowedTools (legacy format)
  // Prefer allowed-tools (spec format) if both are present
  let allowedToolsArray: string[] | undefined;
  const allowedToolsSpec = parsed.data['allowed-tools'] as string | undefined;
  const allowedToolsLegacy = parsed.data.allowedTools as string[] | undefined;

  if (allowedToolsSpec) {
    // Parse space-delimited string into array for internal use
    allowedToolsArray = allowedToolsSpec
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);
  } else if (allowedToolsLegacy) {
    allowedToolsArray = allowedToolsLegacy;
  }

  // Extract metadata (spec field)
  const metadata = parsed.data.metadata as Record<string, unknown> | undefined;

  const frontmatter: SkillFrontmatter = {
    // Required fields (spec)
    name: parsed.data.name as string,
    description: parsed.data.description as string,

    // Optional spec fields
    license: parsed.data.license as string | undefined,
    compatibility: parsed.data.compatibility as string | undefined,
    metadata,
    'allowed-tools': allowedToolsSpec,

    // A-Coder CLI extensions
    argumentHint: parsed.data.argumentHint as string | undefined,
    disableModelInvocation: parsed.data.disableModelInvocation as
      | boolean
      | undefined,
    userInvocable: parsed.data.userInvocable as boolean | undefined,
    allowedTools: allowedToolsArray,
    model: parsed.data.model as string | undefined,
    context: parsed.data.context as 'inline' | 'fork' | undefined,
    agent: parsed.data.agent as string | undefined,
    hooks,
  };

  // Validate the frontmatter
  validateFrontmatter(frontmatter, skillDirName);

  return {
    frontmatter,
    content: parsed.content,
  };
}

/**
 * Validate frontmatter fields according to Agent Skills Specification
 *
 * @param frontmatter - The parsed frontmatter to validate
 * @param skillDirName - Optional directory name for name validation
 * @returns Validated frontmatter with defaults applied
 * @throws SkillFrontmatterError if validation fails
 */
export function validateFrontmatter(
  frontmatter: SkillFrontmatter,
  skillDirName?: string,
): SkillFrontmatter {
  const validated: SkillFrontmatter = { ...frontmatter };
  const errors: string[] = [];

  // Validate required field: name
  // Note: The directory name is the canonical skill identifier. The frontmatter
  // 'name' field is a display name and does not need to match the directory name.
  if (!validated.name || validated.name.trim().length === 0) {
    // If no name in frontmatter, use directory name as the name
    if (skillDirName) {
      validated.name = skillDirName;
    } else {
      errors.push('name is required');
    }
  }

  // Validate required field: description
  if (!validated.description || validated.description.trim().length === 0) {
    errors.push('description is required');
  } else if (validated.description.length > 1024) {
    errors.push('description must be 1-1024 characters');
  }

  // Validate optional field lengths
  if (validated.license && validated.license.length > 500) {
    errors.push('license must be at most 500 characters');
  }
  if (validated.compatibility && validated.compatibility.length > 500) {
    errors.push('compatibility must be at most 500 characters');
  }

  if (errors.length > 0) {
    throw new SkillFrontmatterError(
      `Invalid skill frontmatter: ${errors.join('; ')}`,
    );
  }

  // Apply defaults for A-Coder CLI extensions
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