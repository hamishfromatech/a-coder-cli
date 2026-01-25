/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { homedir } from 'os';
import { randomUUID } from 'crypto';
import { GEMINI_CONFIG_DIR } from './memoryTool.js';

// Environment variable for multi-session task list sharing
export const TASK_LIST_ID_ENV_VAR = 'CLAUDECODETASKLISTID';

// Tasks directory: ~/.a-coder-cli/tasks/
export const TASKS_DIR = path.join(homedir(), GEMINI_CONFIG_DIR, 'tasks');

export type TaskStatus = 'pending' | 'in_progress' | 'completed';

export interface TaskItem {
  id: string;
  subject: string;
  description: string;
  activeForm: string;
  status: TaskStatus;
  blocks: string[]; // Tasks waiting on this one
  blockedBy: string[]; // Tasks this one depends on
  owner?: string; // Agent ID that owns this task
  metadata?: Record<string, unknown>;
}

export interface TaskListSummary {
  id: string;
  tasks: TaskSummary[];
}

export interface TaskSummary {
  id: string;
  subject: string;
  status: TaskStatus;
  owner?: string;
  blockedBy: string[];
}

/**
 * Get the current task list ID from environment variable
 */
export function getTaskListId(): string {
  return process.env[TASK_LIST_ID_ENV_VAR] ?? 'default';
}

/**
 * Get the directory for the current task list
 */
export function getTaskListDir(taskListId?: string): string {
  const listId = taskListId ?? getTaskListId();
  return path.join(TASKS_DIR, listId);
}

/**
 * Get the file path for a specific task
 */
export function getTaskFilePath(taskId: string, taskListId?: string): string {
  const listDir = getTaskListDir(taskListId);
  return path.join(listDir, `${taskId}.json`);
}

/**
 * Ensure the tasks directory exists
 */
export async function ensureTasksDir(): Promise<void> {
  await fs.mkdir(TASKS_DIR, { recursive: true });
}

/**
 * Ensure a task list directory exists
 */
export async function ensureTaskListDir(taskListId?: string): Promise<void> {
  const listDir = getTaskListDir(taskListId);
  await fs.mkdir(listDir, { recursive: true });
}

/**
 * Create a new task list with a unique ID
 */
export async function createTaskList(taskListId?: string): Promise<string> {
  const listId = taskListId ?? randomUUID();
  await ensureTaskListDir(listId);
  return listId;
}

/**
 * Save a task to disk
 */
export async function saveTask(
  task: TaskItem,
  taskListId?: string,
): Promise<void> {
  await ensureTaskListDir(taskListId);
  const filePath = getTaskFilePath(task.id, taskListId);
  await fs.writeFile(filePath, JSON.stringify(task, null, 2), 'utf-8');
}

/**
 * Load a task from disk
 */
export async function loadTask(
  taskId: string,
  taskListId?: string,
): Promise<TaskItem | null> {
  const filePath = getTaskFilePath(taskId, taskListId);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return JSON.parse(content) as TaskItem;
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * Delete a task from disk
 */
export async function deleteTask(
  taskId: string,
  taskListId?: string,
): Promise<void> {
  const filePath = getTaskFilePath(taskId, taskListId);
  await fs.unlink(filePath);
}

/**
 * List all tasks in the task list
 */
export async function listTasks(taskListId?: string): Promise<TaskItem[]> {
  const listDir = getTaskListDir(taskListId);
  try {
    const entries = await fs.readdir(listDir);
    const tasks: TaskItem[] = [];

    for (const entry of entries) {
      if (entry.endsWith('.json')) {
        const taskId = entry.slice(0, -5); // Remove .json extension
        const task = await loadTask(taskId, taskListId);
        if (task) {
          tasks.push(task);
        }
      }
    }

    // Sort by numeric ID if possible, otherwise by string ID
    tasks.sort((a, b) => {
      const aNum = parseInt(a.id, 10);
      const bNum = parseInt(b.id, 10);
      if (!isNaN(aNum) && !isNaN(bNum)) {
        return aNum - bNum;
      }
      return a.id.localeCompare(b.id);
    });

    return tasks;
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return [];
    }
    throw error;
  }
}

/**
 * Get task summaries for listing
 */
export async function getTaskSummaries(
  taskListId?: string,
): Promise<TaskSummary[]> {
  const tasks = await listTasks(taskListId);
  return tasks.map(
    (t) =>
      ({
        id: t.id,
        subject: t.subject,
        status: t.status,
        owner: t.owner,
        blockedBy: t.blockedBy,
      }) as TaskSummary,
  );
}

/**
 * Generate a unique task ID
 * Tasks are numbered sequentially starting from 1
 */
export async function generateTaskId(taskListId?: string): Promise<string> {
  const tasks = await listTasks(taskListId);
  const numericIds = tasks
    .map((t) => parseInt(t.id, 10))
    .filter((n) => !isNaN(n));

  if (numericIds.length === 0) {
    return '1';
  }

  return String(Math.max(...numericIds) + 1);
}

/**
 * Check if a task is blocked (has incomplete dependencies)
 */
export function isTaskBlocked(
  task: TaskItem,
  allTasks: Map<string, TaskItem>,
): boolean {
  return task.blockedBy.some((depId) => {
    const depTask = allTasks.get(depId);
    return depTask && depTask.status !== 'completed';
  });
}

/**
 * Update dependency relationships when a task status changes
 */
export async function updateDependencies(
  task: TaskItem,
  allTasks: Map<string, TaskItem>,
  taskListId?: string,
): Promise<void> {
  // When a task completes, remove it from blockedBy of tasks it blocks
  if (task.status === 'completed') {
    for (const blockedTaskId of task.blocks) {
      const blockedTask = allTasks.get(blockedTaskId);
      if (blockedTask) {
        blockedTask.blockedBy = blockedTask.blockedBy.filter(
          (id) => id !== task.id,
        );
        await saveTask(blockedTask, taskListId);
      }
    }
  }
}

/**
 * Format task list as a cascading outline view
 */
export function formatTaskOutline(tasks: TaskItem[]): string {
  if (tasks.length === 0) {
    return 'No tasks in the list.';
  }

  const taskMap = new Map(tasks.map((t) => [t.id, t]));
  const lines: string[] = [];

  // Find root tasks (no dependencies or dependencies completed)
  const rootTasks = tasks.filter(
    (t) => !isTaskBlocked(t, taskMap) && t.status !== 'completed',
  );

  // Sort by ID
  rootTasks.sort((a, b) => {
    const aNum = parseInt(a.id, 10);
    const bNum = parseInt(b.id, 10);
    if (!isNaN(aNum) && !isNaN(bNum)) {
      return aNum - bNum;
    }
    return a.id.localeCompare(b.id);
  });

  // Add root tasks
  for (const task of rootTasks) {
    lines.push(formatTaskLine(task, 0));
    // Add blocked tasks as children
    for (const blockedId of task.blocks) {
      const blockedTask = taskMap.get(blockedId);
      if (blockedTask && blockedTask.status !== 'completed') {
        addTaskToOutline(blockedTask, taskMap, lines, 1);
      }
    }
  }

  // Add completed tasks at the end
  const completedTasks = tasks.filter((t) => t.status === 'completed');
  if (completedTasks.length > 0) {
    lines.push('');
    lines.push('Completed:');
    for (const task of completedTasks) {
      lines.push(formatTaskLine(task, 0));
    }
  }

  return lines.join('\n');
}

function addTaskToOutline(
  task: TaskItem,
  taskMap: Map<string, TaskItem>,
  lines: string[],
  indent: number,
): void {
  lines.push(formatTaskLine(task, indent));
  // Add children (tasks this one blocks)
  for (const blockedId of task.blocks) {
    const blockedTask = taskMap.get(blockedId);
    if (blockedTask && blockedTask.status !== 'completed') {
      addTaskToOutline(blockedTask, taskMap, lines, indent + 1);
    }
  }
}

function formatTaskLine(task: TaskItem, indent: number): string {
  const prefix = '  '.repeat(indent);
  const statusIcon = getStatusIcon(task.status);
  const ownerStr = task.owner ? ` [${task.owner}]` : '';
  return `${prefix}#${task.id} ${statusIcon} ${task.subject}${ownerStr}`;
}

function getStatusIcon(status: TaskStatus): string {
  switch (status) {
    case 'pending':
      return '○';
    case 'in_progress':
      return '❯';
    case 'completed':
      return '✓';
    default:
      return '?';
  }
}

/**
 * Clear all tasks in a task list
 */
export async function clearTaskList(taskListId?: string): Promise<void> {
  const listDir = getTaskListDir(taskListId);
  try {
    const entries = await fs.readdir(listDir);
    for (const entry of entries) {
      const filePath = path.join(listDir, entry);
      await fs.unlink(filePath);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      // Directory doesn't exist, nothing to clear
      return;
    }
    throw error;
  }
}

/**
 * Delete an entire task list
 */
export async function deleteTaskList(taskListId?: string): Promise<void> {
  const listDir = getTaskListDir(taskListId);
  await fs.rm(listDir, { recursive: true, force: true });
}