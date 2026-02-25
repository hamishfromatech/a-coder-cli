/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { Box, Text } from 'ink';
import { ToDoItem } from '@a-coder/core';
import { Colors, Semantic } from '../colors.js';

interface ToDoListProps {
  todos: ToDoItem[];
}

export const ToDoList = ({ todos }: ToDoListProps) => {
  if (todos.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" paddingX={1} marginBottom={1}>
      <Text bold color={Semantic.Info}>
        Plan:
      </Text>
      {todos.map((todo, index) => (
        <Box key={index} marginLeft={1}>
          <Text color={getStatusColor(todo.status)}>
            {getStatusIcon(todo.status)} {todo.description}
          </Text>
        </Box>
      ))}
    </Box>
  );
};

function getStatusIcon(status: ToDoItem['status']): string {
  switch (status) {
    case 'completed':
      return '✓';
    case 'in_progress':
      return '❯';
    case 'cancelled':
      return '✕';
    case 'pending':
    default:
      return '○';
  }
}

function getStatusColor(status: ToDoItem['status']): string {
  switch (status) {
    case 'completed':
      return Semantic.Success;
    case 'in_progress':
      return Semantic.Warning;
    case 'cancelled':
      return Semantic.Muted;
    case 'pending':
    default:
      return Semantic.Info;
  }
}
