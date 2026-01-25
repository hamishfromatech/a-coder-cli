/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Schema, Type } from '@google/genai';
import { BaseTool, ToolResult } from './tools.js';
import {
  listTasks,
  getTaskListId,
  getTaskListDir,
  formatTaskOutline,
  isTaskBlocked,
  TASK_LIST_ID_ENV_VAR,
} from './tasks.js';

export interface TaskListParams {}

/**
 * Tool for the agent to list all tasks in the task list.
 */
export class TaskListTool extends BaseTool<TaskListParams, ToolResult> {
  static readonly Name = 'TaskList';

  constructor() {
    super(
      TaskListTool.Name,
      'List Tasks',
      `Lists all tasks in the persistent task list.

Use this to:
- See the current status of all tasks
- Understand task dependencies and workflow
- Identify which tasks are available to work on
- Track overall progress

The output shows:
- Task ID, status indicator, and subject
- Dependency relationships (parent → child tasks)
- Status indicators: ○ pending, ❯ in_progress, ✓ completed
- Owner (if assigned) in brackets after the subject
- Blocked tasks won't show until their dependencies complete

Tasks are organized as a cascading outline showing dependency flow.
Available tasks (not blocked, not completed) appear at the top.
Completed tasks appear at the bottom.`,
      {
        type: Type.OBJECT,
        properties: {},
        required: [],
      } as Schema,
      false, // isOutputMarkdown
      false, // canUpdateOutput
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async execute(
    params: TaskListParams,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    const taskListId = getTaskListId();
    const tasks = await listTasks(taskListId);

    if (tasks.length === 0) {
      const summary = `No tasks in task list "${taskListId}".`;
      return {
        summary,
        llmContent: [{ text: summary }],
        returnDisplay: summary,
      };
    }

    // Build task map for status checking
    const taskMap = new Map(tasks.map((t) => [t.id, t]));

    // Count by status
    const pending = tasks.filter((t) => t.status === 'pending').length;
    const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
    const completed = tasks.filter((t) => t.status === 'completed').length;

    // Count available tasks (pending and not blocked)
    const available = tasks.filter(
      (t) => t.status === 'pending' && !isTaskBlocked(t, taskMap),
    ).length;

    const outline = formatTaskOutline(tasks);

    const summary = `Task list "${taskListId}" (${tasks.length} tasks): ${available} available, ${inProgress} in progress, ${completed} completed.`;

    const llmContent = [
      {
        text: `Task List ID: ${taskListId}${TASK_LIST_ID_ENV_VAR ? ` (env var: ${TASK_LIST_ID_ENV_VAR})` : ''}
Directory: ${getTaskListDir()}

Summary: ${tasks.length} tasks total
- Available (pending, not blocked): ${available}
- In Progress: ${inProgress}
- Completed: ${completed}

${outline}`,
      },
    ];

    return {
      summary,
      llmContent,
      returnDisplay: summary,
    };
  }
}