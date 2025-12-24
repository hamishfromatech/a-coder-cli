/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Schema, Type } from '@google/genai';
import { BaseTool, ToolResult } from './tools.js';

export interface ToDoItem {
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'cancelled';
}

export interface WriteToDosParams {
  todos: ToDoItem[];
}

/**
 * Tool for the agent to maintain a list of subtasks.
 */
export class WriteToDosTool extends BaseTool<WriteToDosParams, ToolResult> {
  static Name = 'write_todos';

  constructor() {
    super(
      WriteToDosTool.Name,
      'Write ToDos',
      'Updates the current list of subtasks to be completed for the given user request. Use this to track progress and plan complex tasks.',
      {
        type: Type.OBJECT,
        properties: {
          todos: {
            type: Type.ARRAY,
            description: 'The complete list of todo items. This will replace the existing list.',
            items: {
              type: Type.OBJECT,
              properties: {
                description: {
                  type: Type.STRING,
                  description: 'The description of the task.',
                },
                status: {
                  type: Type.STRING,
                  description: 'The current status of the task.',
                  enum: ['pending', 'in_progress', 'completed', 'cancelled'],
                },
              },
              required: ['description', 'status'],
            },
          },
        },
        required: ['todos'],
      } as Schema,
      false, // isOutputMarkdown
      false, // canUpdateOutput
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async execute(params: WriteToDosParams, signal: AbortSignal): Promise<ToolResult> {
    const todoCount = params.todos?.length ?? 0;
    const summary = `Updated ToDo list with ${todoCount} items.`;
    return {
      summary,
      llmContent: [
        {
          text: `Successfully updated the todo list. The current list is now:\n${params.todos
            .map((t, i) => `${i + 1}. [${t.status}] ${t.description}`)
            .join('\n')}`,
        },
      ],
      returnDisplay: summary,
    };
  }
}
