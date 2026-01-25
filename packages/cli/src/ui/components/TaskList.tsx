/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from 'ink';
import { TaskItem } from '@a-coder/core';
import { Colors } from '../colors.js';

interface TaskListProps {
  tasks: TaskItem[];
}

export const TaskList = ({ tasks }: TaskListProps) => {
  if (tasks.length === 0) {
    return null;
  }

  const taskMap = new Map(tasks.map((t) => [t.id, t]));

  // Filter to pending and in_progress tasks that aren't blocked
  const availableTasks = tasks.filter(
    (t) =>
      (t.status === 'pending' || t.status === 'in_progress') &&
      !isTaskBlocked(t, taskMap),
  );

  // Find root tasks for the tree display
  const rootTasks = availableTasks.filter(
    (t) => !taskWasInOriginalTree(t.id, availableTasks, taskMap),
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

  return (
    <Box flexDirection="column" paddingX={1} marginBottom={1}>
      <Text bold color={Colors.LightBlue}>
        Tasks:
      </Text>
      {rootTasks.map((task) => (
        <TaskTree key={task.id} task={task} taskMap={taskMap} indent={1} />
      ))}
      {renderCompletedTasks(tasks)}
    </Box>
  );
};

interface TaskTreeProps {
  task: TaskItem;
  taskMap: Map<string, TaskItem>;
  indent: number;
}

const TaskTree = ({ task, taskMap, indent }: TaskTreeProps) => {
  const prefix = '  '.repeat(indent);
  const statusIcon = getStatusIcon(task.status);
  const ownerStr = task.owner ? ` [${task.owner}]` : '';
  const blocked =
    task.status === 'pending' &&
    task.blockedBy.some((depId) => {
      const dep = taskMap.get(depId);
      return dep && dep.status !== 'completed';
    });

  return (
    <Box flexDirection="column">
      <Box>
        <Text color={blocked ? Colors.Gray : getStatusColor(task.status)}>
          {prefix}{statusIcon} #{task.id} {task.subject}{ownerStr}
        </Text>
      </Box>
      {/* Render children (tasks blocked by this one) */}
      {task.blocks.map((blockId) => {
        const blockedTask = taskMap.get(blockId);
        if (blockedTask && blockedTask.status !== 'completed') {
          return (
            <TaskTree
              key={blockId}
              task={blockedTask}
              taskMap={taskMap}
              indent={indent + 1}
            />
          );
        }
        return null;
      })}
    </Box>
  );
};

const renderCompletedTasks = (tasks: TaskItem[]) => {
  const completed = tasks.filter((t) => t.status === 'completed');
  if (completed.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column">
      <Box>
        <Text dimColor>Completed:</Text>
      </Box>
      {completed.map((task) => {
        const ownerStr = task.owner ? ` [${task.owner}]` : '';
        return (
          <Box key={task.id} marginLeft={1}>
            <Text dimColor>
              ✓ #{task.id} {task.subject}{ownerStr}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
};

function taskWasInOriginalTree(
  taskId: string,
  availableTasks: TaskItem[],
  taskMap: Map<string, TaskItem>,
): boolean {
  // Check if any other task has this task in its blocks
  return availableTasks.some((t) => t.blocks.includes(taskId));
}

function isTaskBlocked(
  task: TaskItem,
  taskMap: Map<string, TaskItem>,
): boolean {
  return task.blockedBy.some((depId) => {
    const depTask = taskMap.get(depId);
    return depTask && depTask.status !== 'completed';
  });
}

function getStatusIcon(status: TaskItem['status']): string {
  switch (status) {
    case 'completed':
      return '✓';
    case 'in_progress':
      return '❯';
    case 'pending':
    default:
      return '○';
  }
}

function getStatusColor(status: TaskItem['status']): string {
  switch (status) {
    case 'completed':
      return Colors.AccentGreen;
    case 'in_progress':
      return Colors.AccentYellow;
    case 'pending':
    default:
      return Colors.LightBlue;
  }
}