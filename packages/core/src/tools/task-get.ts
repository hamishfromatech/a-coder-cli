/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Schema, Type } from '@google/genai';
import { BaseTool, ToolResult } from './tools.js';
import { loadTask, getTaskListId, listTasks, isTaskBlocked } from './tasks.js';

export interface TaskGetParams {
  taskId: string;
}

/**
 * Tool for the agent to retrieve a specific task from the task list.
 */
export class TaskGetTool extends BaseTool<TaskGetParams, ToolResult> {
  static readonly Name = 'TaskGet';

  constructor() {
    super(
      TaskGetTool.Name,
      'Get Task',
      `Retrieves a specific task by ID from the persistent task list.

Use this when you need to:
- Check the full details of a task (subject, description, status)
- Verify task dependencies (blockedBy, blocks)
- Review task requirements before starting work
- Check task metadata

Returns the full task object with all details including:
- id: Unique task identifier
- subject: Brief task title
- description: Detailed task description
- activeForm: Display form for progress indicator
- status: pending, in_progress, or completed
- blockedBy: Array of task IDs this task depends on
- blocks: Array of task IDs waiting on this one
- owner: Agent ID that owns this task (if assigned)
- metadata: Optional task metadata`,
      {
        type: Type.OBJECT,
        properties: {
          taskId: {
            type: Type.STRING,
            description: 'The ID of the task to retrieve (e.g., "1", "2", "3").',
          },
        },
        required: ['taskId'],
      } as Schema,
      false, // isOutputMarkdown
      false, // canUpdateOutput
    );
  }

  async execute(
    params: TaskGetParams,
    signal: AbortSignal,
  ): Promise<ToolResult> {
    const taskListId = getTaskListId();
    const task = await loadTask(params.taskId, taskListId);

    if (!task) {
      const summary = `Task #${params.taskId} not found in task list "${taskListId}".`;
      return {
        summary,
        llmContent: [{ text: summary }],
        returnDisplay: summary,
      };
    }

    // Check if task is blocked
    const allTasks = await listTasks(taskListId);
    const taskMap = new Map(allTasks.map((t) => [t.id, t]));
    const blocked = isTaskBlocked(task, taskMap);

    const blockedByStr =
      task.blockedBy.length > 0
        ? `\nBlocked by: #${task.blockedBy.join(', #')}`
        : '';

    const blocksStr =
      task.blocks.length > 0
        ? `\nBlocks: #${task.blocks.join(', #')}`
        : '';

    const ownerStr = task.owner ? `\nOwner: ${task.owner}` : '';

    const summary = `Retrieved task #${task.id}: ${task.subject}`;

    const llmContent = [
      {
        text: `Task #${task.id}: ${task.subject}
Status: ${task.status}${blocked ? ' (blocked)' : ''}${ownerStr}${blockedByStr}${blocksStr}

Description:
${task.description}

Active Form: ${task.activeForm}`,
      },
    ];

    if (task.metadata && Object.keys(task.metadata).length > 0) {
      llmContent.push({
        text: `\nMetadata:\n${JSON.stringify(task.metadata, null, 2)}`,
      });
    }

    return {
      summary,
      llmContent,
      returnDisplay: summary,
    };
  }
}