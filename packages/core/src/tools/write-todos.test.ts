/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { WriteToDosTool, WriteToDosParams } from './write-todos.js';

describe('WriteToDosTool', () => {
  const tool = new WriteToDosTool();

  it('should have the correct name and description', () => {
    expect(tool.name).toBe('write_todos');
    expect(tool.description).toContain('subtasks');
  });

  it('should execute and return a summary and llmContent', async () => {
    const params: WriteToDosParams = {
      todos: [
        { description: 'Task 1', status: 'completed' },
        { description: 'Task 2', status: 'in_progress' },
      ],
    };
    const abortSignal = new AbortController().signal;
    const result = await tool.execute(params, abortSignal);

    expect(result.summary).toContain('2 items');
    expect(result.llmContent).toHaveLength(1);
    const content = (result.llmContent as any)[0].text;
    expect(content).toContain('[completed] Task 1');
    expect(content).toContain('[in_progress] Task 2');
    expect(result.returnDisplay).toBe(result.summary);
  });

  it('should handle empty todo list', async () => {
    const params: WriteToDosParams = {
      todos: [],
    };
    const abortSignal = new AbortController().signal;
    const result = await tool.execute(params, abortSignal);

    expect(result.summary).toContain('0 items');
  });
});
