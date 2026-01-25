/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Schema, Type } from '@google/genai';
import { BaseTool, ToolResult } from './tools.js';
import {
  TaskItem,
  generateTaskId,
  saveTask,
  TASK_LIST_ID_ENV_VAR,
  getTaskListId,
  ensureTaskListDir,
  listTasks,
} from './tasks.js';

export interface TaskCreateParams {
  subject: string;
  description: string;
  activeForm: string;
  metadata?: Record<string, unknown>;
}

/**
 * Tool for the agent to create a new task in the persistent task list.
 */
export class TaskCreateTool extends BaseTool<TaskCreateParams, ToolResult> {
  static readonly Name = 'TaskCreate';

  constructor() {
    super(
      TaskCreateTool.Name,
      'Create Task',
      `Creates a new task in the persistent task list. Use this to track progress and plan complex tasks.

Tasks are stored on disk and persist across sessions. Each task has:
- A unique ID (auto-generated)
- A brief subject/title
- A detailed description
- An active form for display (e.g., "Creating task" vs "Create task")
- Dependencies via blockedBy/addBlockedBy (set these when creating dependent tasks)

When to use this tool:
- Multi-file features spanning several components
- Large refactors touching many codebase parts
- Projects stretching across multiple sessions
- Work involving sub-agents needing coordination
- Anything you might close and come back to later

Don't use this for:
- Quick bug fixes
- Single-file refactors
- Simple questions or explanations
- Anything that can be handled in one shot

Use TaskUpdate to mark tasks as in_progress or completed, and to manage dependencies.`,
      {
        type: Type.OBJECT,
        properties: {
          subject: {
            type: Type.STRING,
            description:
              'A brief, actionable title for the task (imperative form, e.g., "Fix authentication bug in login flow").',
          },
          description: {
            type: Type.STRING,
            description:
              'Detailed description of what needs to be done, including context and acceptance criteria.',
          },
          activeForm: {
            type: Type.STRING,
            description:
              'Present continuous form shown in spinner when task is in_progress (e.g., "Fixing authentication bug").',
          },
          metadata: {
            type: Type.OBJECT,
            description:
              'Optional metadata to attach to the task (e.g., file paths, related tasks, etc.).',
          },
        },
        required: ['subject', 'description', 'activeForm'],
      } as Schema,
      false, // isOutputMarkdown
      false, // canUpdateOutput
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async execute(
    params: TaskCreateParams,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    const taskListId = getTaskListId();
    await ensureTaskListDir(taskListId);

    const taskId = await generateTaskId(taskListId);

    const task: TaskItem = {
      id: taskId,
      subject: params.subject,
      description: params.description,
      activeForm: params.activeForm,
      status: 'pending',
      blocks: [],
      blockedBy: [],
      metadata: params.metadata,
    };

    await saveTask(task, taskListId);

    const allTasks = await listTasks(taskListId);
    const summary = `Created task #${taskId} in task list "${taskListId}" (${allTasks.length} total tasks).`;

    return {
      summary,
      llmContent: [
        {
          text: `Created task #${taskId}: ${task.subject}\n\nStatus: pending\nTask List ID: ${taskListId}${TASK_LIST_ID_ENV_VAR ? ` (env var: ${TASK_LIST_ID_ENV_VAR})` : ''}`,
        },
      ],
      returnDisplay: summary,
    };
  }
}