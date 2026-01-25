/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Schema, Type } from '@google/genai';
import { BaseTool, ToolResult } from './tools.js';
import {
  TaskItem,
  loadTask,
  saveTask,
  getTaskListId,
  listTasks,
  updateDependencies,
} from './tasks.js';

export interface TaskUpdateParams {
  taskId: string;
  subject?: string;
  description?: string;
  activeForm?: string;
  status?: 'pending' | 'in_progress' | 'completed';
  owner?: string;
  addBlocks?: string[];
  addBlockedBy?: string[];
  metadata?: Record<string, unknown> | null;
}

/**
 * Tool for the agent to update an existing task in the task list.
 */
export class TaskUpdateTool extends BaseTool<TaskUpdateParams, ToolResult> {
  static readonly Name = 'TaskUpdate';

  constructor() {
    super(
      TaskUpdateTool.Name,
      'Update Task',
      `Updates an existing task in the persistent task list.

Use this to:
- Mark tasks as in_progress when starting work on them
- Mark tasks as completed when fully finished
- Update task details (subject, description, activeForm)
- Assign ownership to a specific agent
- Set up or modify dependencies

Status workflow:
- pending → in_progress: When you start working on a task
- in_progress → completed: When the task is fully finished and tested
- Any → pending: If you need to reset a task

Dependencies:
- blockedBy: Array of task IDs that must complete before this task can start
- blocks: Array of task IDs waiting on this task to complete
- When marking a task completed, it's automatically removed from blockedBy of tasks it blocks

Important: Always mark tasks as completed when you finish them. This unblocks dependent tasks.`,
      {
        type: Type.OBJECT,
        properties: {
          taskId: {
            type: Type.STRING,
            description: 'The ID of the task to update (e.g., "1", "2", "3").',
          },
          subject: {
            type: Type.STRING,
            description:
              'Optional: Update the task subject/title.',
          },
          description: {
            type: Type.STRING,
            description: 'Optional: Update the task description.',
          },
          activeForm: {
            type: Type.STRING,
            description: 'Optional: Update the active form for display.',
          },
          status: {
            type: Type.STRING,
            description:
              'Optional: Update the task status (pending, in_progress, completed).',
            enum: ['pending', 'in_progress', 'completed'],
          },
          owner: {
            type: Type.STRING,
            description: 'Optional: Assign or update the owner (agent ID).',
          },
          addBlocks: {
            type: Type.ARRAY,
            description:
              'Optional: Add task IDs that are blocked by this task.',
            items: {
              type: Type.STRING,
            },
          },
          addBlockedBy: {
            type: Type.ARRAY,
            description:
              'Optional: Add task IDs that this task depends on (must complete before this task can start).',
            items: {
              type: Type.STRING,
            },
          },
          metadata: {
            type: Type.OBJECT,
            description:
              'Optional: Update or merge task metadata. Set to null to clear.',
          },
        },
        required: ['taskId'],
      } as Schema,
      false, // isOutputMarkdown
      false, // canUpdateOutput
    );
  }

  async execute(
    params: TaskUpdateParams,
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

    // Track changes for summary
    const changes: string[] = [];
    const oldStatus = task.status;

    // Update fields
    if (params.subject !== undefined) {
      task.subject = params.subject;
      changes.push(`subject to "${params.subject}"`);
    }
    if (params.description !== undefined) {
      task.description = params.description;
      changes.push('description');
    }
    if (params.activeForm !== undefined) {
      task.activeForm = params.activeForm;
      changes.push(`active form to "${params.activeForm}"`);
    }
    if (params.status !== undefined) {
      task.status = params.status;
      changes.push(`status from ${oldStatus} to ${params.status}`);
    }
    if (params.owner !== undefined) {
      task.owner = params.owner;
      changes.push(`owner to "${params.owner}"`);
    }
    if (params.addBlocks !== undefined && params.addBlocks.length > 0) {
      for (const blockId of params.addBlocks) {
        if (!task.blocks.includes(blockId)) {
          task.blocks.push(blockId);
          changes.push(`blocked task #${blockId}`);
        }
      }
    }
    if (
      params.addBlockedBy !== undefined &&
      params.addBlockedBy.length > 0
    ) {
      for (const depId of params.addBlockedBy) {
        if (!task.blockedBy.includes(depId)) {
          task.blockedBy.push(depId);
          changes.push(`dependency on task #${depId}`);
        }
      }
    }
    if (params.metadata !== undefined) {
      if (params.metadata === null) {
        task.metadata = undefined;
        changes.push('cleared metadata');
      } else {
        task.metadata = { ...task.metadata, ...params.metadata };
        changes.push('updated metadata');
      }
    }

    await saveTask(task, taskListId);

    // Handle dependency updates if task was completed
    if (params.status === 'completed' && oldStatus !== 'completed') {
      const allTasks = await listTasks(taskListId);
      const taskMap = new Map(allTasks.map((t) => [t.id, t]));
      await updateDependencies(task, taskMap, taskListId);
    }

    const summary =
      changes.length > 0
        ? `Updated task #${task.id}: ${changes.join(', ')}.`
        : `Task #${task.id} already has the requested values.`;

    return {
      summary,
      llmContent: [
        {
          text: `Task #${task.id} updated.
Status: ${task.status}
Subject: ${task.subject}
${task.owner ? `Owner: ${task.owner}` : ''}
${task.blockedBy.length > 0 ? `Blocked by: #${task.blockedBy.join(', #')}` : ''}
${task.blocks.length > 0 ? `Blocks: #${task.blocks.join(', #')}` : ''}`,
        },
      ],
      returnDisplay: summary,
    };
  }
}