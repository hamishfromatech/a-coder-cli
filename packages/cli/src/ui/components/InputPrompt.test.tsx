/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { render } from 'ink-testing-library';
import { InputPrompt, InputPromptProps } from './InputPrompt.js';
import type { TextBuffer } from './shared/text-buffer.js';
import { Config } from '@a-coder/core';
import { CommandContext, SlashCommand } from '../commands/types.js';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';

const mockSlashCommands: SlashCommand[] = [
  { name: 'clear', description: 'Clear screen', action: vi.fn() },
  {
    name: 'memory',
    description: 'Manage memory',
    subCommands: [
      { name: 'show', description: 'Show memory', action: vi.fn() },
      { name: 'add', description: 'Add to memory', action: vi.fn() },
      { name: 'refresh', description: 'Refresh memory', action: vi.fn() },
    ],
  },
  {
    name: 'chat',
    description: 'Manage chats',
    subCommands: [
      {
        name: 'resume',
        description: 'Resume a chat',
        action: vi.fn(),
        completion: async () => ['fix-foo', 'fix-bar'],
      },
    ],
  },
];

describe('InputPrompt', () => {
  let props: InputPromptProps;
  let mockBuffer: TextBuffer;
  let mockCommandContext: CommandContext;
  let mockSetShellModeActive: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetAllMocks();

    mockCommandContext = createMockCommandContext();
    mockSetShellModeActive = vi.fn();

    mockBuffer = {
      text: '',
      cursor: [0, 0],
      lines: [''],
      setText: vi.fn((newText: string) => {
        mockBuffer.text = newText;
        mockBuffer.lines = newText.split('\n');
        mockBuffer.cursor = [0, newText.length];
        mockBuffer.viewportVisualLines = newText.split('\n');
        mockBuffer.allVisualLines = newText.split('\n');
      }),
      replaceRangeByOffset: vi.fn(),
      viewportVisualLines: [''],
      allVisualLines: [''],
      visualCursor: [0, 0],
      visualScrollRow: 0,
      handleInput: vi.fn(),
      move: vi.fn(),
      moveToOffset: vi.fn(),
      killLineRight: vi.fn(),
      killLineLeft: vi.fn(),
      openInExternalEditor: vi.fn(),
      newline: vi.fn(),
      backspace: vi.fn(),
    } as unknown as TextBuffer;

    props = {
      buffer: mockBuffer,
      onSubmit: vi.fn(),
      userMessages: [],
      onClearScreen: vi.fn(),
      config: {
        getProjectRoot: () => '/test/project',
        getTargetDir: () => '/test/project/src',
      } as unknown as Config,
      slashCommands: mockSlashCommands,
      commandContext: mockCommandContext,
      shellModeActive: false,
      setShellModeActive: mockSetShellModeActive,
      inputWidth: 80,
      suggestionsWidth: 80,
      focus: true,
    };
  });

  it('renders without crashing', () => {
    const { unmount } = render(<InputPrompt {...props} />);
    unmount();
  });

  it('renders in shell mode', () => {
    props.shellModeActive = true;
    const { unmount } = render(<InputPrompt {...props} />);
    unmount();
  });

  it('renders when disabled', () => {
    props.disabled = true;
    const { unmount } = render(<InputPrompt {...props} />);
    unmount();
  });

  it('renders with text in buffer', () => {
    mockBuffer.text = 'hello world';
    mockBuffer.lines = ['hello world'];
    mockBuffer.viewportVisualLines = ['hello world'];
    mockBuffer.allVisualLines = ['hello world'];
    const { unmount } = render(<InputPrompt {...props} />);
    unmount();
  });

  it('renders with placeholder when buffer is empty', () => {
    const { lastFrame, unmount } = render(<InputPrompt {...props} />);
    const output = lastFrame();
    expect(output).toContain('Type your message');
    unmount();
  });

  it('renders shell mode indicator', () => {
    props.shellModeActive = true;
    const { lastFrame, unmount } = render(<InputPrompt {...props} />);
    const output = lastFrame();
    expect(output).toContain('!');
    unmount();
  });

  it('renders with custom placeholder', () => {
    props.placeholder = 'Custom placeholder text';
    const { lastFrame, unmount } = render(<InputPrompt {...props} />);
    const output = lastFrame();
    expect(output).toContain('Custom placeholder');
    unmount();
  });

  it('renders without focus', () => {
    props.focus = false;
    const { unmount } = render(<InputPrompt {...props} />);
    unmount();
  });

  it('renders with multi-line buffer content', () => {
    mockBuffer.text = 'line1\nline2\nline3';
    mockBuffer.lines = ['line1', 'line2', 'line3'];
    mockBuffer.viewportVisualLines = ['line1', 'line2', 'line3'];
    mockBuffer.allVisualLines = ['line1', 'line2', 'line3'];
    const { unmount } = render(<InputPrompt {...props} />);
    unmount();
  });
});
