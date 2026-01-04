/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SkillsTool, SkillsToolParams } from './skills.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GEMINI_DIR } from '../utils/paths.js';

// Mock fs and os
vi.mock('fs');
vi.mock('os');

describe('SkillsTool', () => {
  let tool: SkillsTool;
  const mockHomeDir = '/mock/home';
  const mockSkillsDir = path.join(mockHomeDir, GEMINI_DIR, 'skills');

  beforeEach(() => {
    vi.resetAllMocks();
    (os.homedir as any).mockReturnValue(mockHomeDir);
    tool = new SkillsTool();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should have the correct name', () => {
    expect(tool.name).toBe('skills');
  });

  describe('list action', () => {
    it('should create skills directory if it does not exist', async () => {
      (fs.existsSync as any).mockReturnValue(false);
      (fs.mkdirSync as any).mockImplementation(() => {});

      const params: SkillsToolParams = { action: 'list' };
      const abortSignal = new AbortController().signal;
      await tool.execute(params, abortSignal);

      expect(fs.mkdirSync).toHaveBeenCalledWith(mockSkillsDir, { recursive: true });
    });

    it('should list available skills', async () => {
      (fs.existsSync as any).mockImplementation((pathStr: string) => {
        if (pathStr === mockSkillsDir) return true;
        if (pathStr.endsWith('SKILL.md')) return true;
        return false;
      });
      (fs.readdirSync as any).mockReturnValue([
        { name: 'skill1', isDirectory: () => true },
        { name: 'skill2', isDirectory: () => true },
        { name: 'not_a_skill', isDirectory: () => false },
      ]);

      const params: SkillsToolParams = { action: 'list' };
      const abortSignal = new AbortController().signal;
      const result = await tool.execute(params, abortSignal);

      expect(result.llmContent).toContain('Available skills: skill1, skill2');
    });

    it('should handle no skills found', async () => {
      (fs.existsSync as any).mockReturnValue(true);
      (fs.readdirSync as any).mockReturnValue([]);

      const params: SkillsToolParams = { action: 'list' };
      const abortSignal = new AbortController().signal;
      const result = await tool.execute(params, abortSignal);

      expect(result.llmContent).toContain('No skills found');
    });
  });

  describe('load action', () => {
    it('should validate missing skill_name for load action', () => {
      const params: SkillsToolParams = { action: 'load' };
      const error = tool.validateToolParams(params);
      expect(error).toContain('required');
    });

    it('should return error if skill does not exist', async () => {
        (fs.existsSync as any).mockReturnValue(false); // Skills dir exists check in execute
        // We need skills dir to exist to pass that check
        (fs.existsSync as any).mockImplementation((p: string) => {
             if (p === mockSkillsDir) return true;
             return false;
        });

      const params: SkillsToolParams = { action: 'load', skill_name: 'missing_skill' };
      const abortSignal = new AbortController().signal;
      const result = await tool.execute(params, abortSignal);

      expect(result.llmContent).toContain('Skill "missing_skill" not found');
    });

    it('should load skill content', async () => {
       (fs.existsSync as any).mockImplementation((p: string) => {
             if (p === mockSkillsDir) return true;
             if (p.includes('valid_skill')) return true;
             return false;
        });
      (fs.readFileSync as any).mockReturnValue('Skill instructions content');

      const params: SkillsToolParams = { action: 'load', skill_name: 'valid_skill' };
      const abortSignal = new AbortController().signal;
      const result = await tool.execute(params, abortSignal);

      expect(result.llmContent).toContain('Loaded Skill: valid_skill');
      expect(result.llmContent).toContain('Skill instructions content');
    });
  });
});
