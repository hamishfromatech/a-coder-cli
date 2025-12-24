/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import { render } from 'ink-testing-library';
import React from 'react';
import { ToDoList } from './ToDoList.js';
import { ToDoItem } from '@a-coder/core';

// Mock Colors to avoid theme dependency in tests
vi.mock('../colors.js', () => ({
  Colors: {
    info: 'blue',
    success: 'green',
    warning: 'yellow',
    subtle: 'gray',
    AccentGreen: 'green',
    AccentYellow: 'yellow',
    Gray: 'gray',
    LightBlue: 'blue',
  },
}));

describe('ToDoList', () => {
  it('should render nothing when todos is empty', () => {
    const { lastFrame } = render(<ToDoList todos={[]} />);
    expect(lastFrame()).toBe('');
  });

  it('should render the list of todos with correct icons', () => {
    const todos: ToDoItem[] = [
      { description: 'Task 1', status: 'completed' },
      { description: 'Task 2', status: 'in_progress' },
      { description: 'Task 3', status: 'pending' },
      { description: 'Task 4', status: 'cancelled' },
    ];
    const { lastFrame } = render(<ToDoList todos={todos} />);
    const frame = lastFrame();
    
    expect(frame).toContain('Plan:');
    expect(frame).toContain('✓ Task 1');
    expect(frame).toContain('❯ Task 2');
    expect(frame).toContain('○ Task 3');
    expect(frame).toContain('✕ Task 4');
  });
});
