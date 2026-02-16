import React from 'react'
import { Box, Text } from 'ink'
import type { TaskView } from '../types.js'
import { getStatusIcon, getStatusLabel, truncateText } from '../utils.js'

type Props = {
  task: TaskView
  allTasks: TaskView[]
  columns: number
}

/**
 * Detail panel shown below the task list when a task is selected.
 * Displays full title, intent summary, status, agent, parent/child info.
 */
export function TaskDetail({ task, allTasks, columns }: Props) {
  const parentTask = task.parentTaskId
    ? allTasks.find((t) => t.taskId === task.parentTaskId)
    : undefined
  const childTasks = allTasks.filter((t) => t.parentTaskId === task.taskId)
  const statusIcon = getStatusIcon(task.status)
  const statusLabel = getStatusLabel(task.status)
  const agentLabel = task.agentId.replace(/^agent_/, '')
  const isTerminal = ['done', 'failed', 'canceled'].includes(task.status)
  const todos = task.todos ?? []
  const pendingTodos = todos.filter((todo) => todo.status === 'pending')
  const completedTodos = todos.filter((todo) => todo.status === 'completed')
  const nextTodo = pendingTodos[0]
  const maxVisibleTodos = 6

  return (
    <Box
      flexDirection="column"
      paddingX={2}
      marginX={1}
      borderStyle="single"
      borderColor={isTerminal ? 'gray' : 'cyan'}
    >
      {/* Title row */}
      <Box>
        <Text bold color={isTerminal ? 'gray' : 'white'}>
          {truncateText(task.title, columns - 8)}
        </Text>
      </Box>

      {/* Status + Agent row */}
      <Box gap={1}>
        <Text>
          {statusIcon} <Text color="yellow">{statusLabel}</Text>
        </Text>
        <Text dimColor>│</Text>
        <Text color="magenta">{agentLabel}</Text>
        <Text dimColor>│</Text>
        <Text dimColor>ID: {task.taskId.slice(0, 12)}</Text>
      </Box>

      {/* Parent info */}
      {parentTask ? (
        <Box>
          <Text dimColor>↑ Parent: </Text>
          <Text color="cyan">{truncateText(parentTask.title, columns - 20)}</Text>
          <Text dimColor> [{parentTask.taskId.slice(0, 8)}]</Text>
        </Box>
      ) : null}

      {/* Children info */}
      {childTasks.length > 0 ? (
        <Box flexDirection="column">
          <Text dimColor>↓ Subtasks ({childTasks.length}):</Text>
          {childTasks.slice(0, 5).map((child) => (
            <Box key={child.taskId} paddingLeft={2}>
              <Text>
                {getStatusIcon(child.status)}{' '}
              </Text>
              <Text dimColor={['done', 'failed', 'canceled'].includes(child.status)}>
                {truncateText(child.title, columns - 30)}
              </Text>
              <Text dimColor> [{child.taskId.slice(0, 8)}]</Text>
            </Box>
          ))}
          {childTasks.length > 5 ? (
            <Box paddingLeft={2}><Text dimColor>… and {childTasks.length - 5} more</Text></Box>
          ) : null}
        </Box>
      ) : null}

      {/* Summary / failure reason */}
      {task.summary ? (
        <Box>
          <Text color="green" dimColor>✓ {truncateText(task.summary, columns - 8)}</Text>
        </Box>
      ) : null}
      {task.failureReason ? (
        <Box>
          <Text color="red">✖ {truncateText(task.failureReason, columns - 8)}</Text>
        </Box>
      ) : null}

      {/* Todo list */}
      {todos.length === 0 ? (
        <Box>
          <Text dimColor>Todos: No todos yet</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Text dimColor>
            Todos: {pendingTodos.length} pending / {completedTodos.length} completed
          </Text>
          {nextTodo ? (
            <Text color="yellow">
              Next: {truncateText(nextTodo.title, columns - 8)}
            </Text>
          ) : (
            <Text color="green">All todo complete</Text>
          )}
          {todos.slice(0, maxVisibleTodos).map((todo) => (
            <Box key={todo.id} paddingLeft={2}>
              <Text dimColor={todo.status === 'completed'}>
                {todo.status === 'completed' ? '[x]' : '[ ]'} {truncateText(todo.title, columns - 16)}
              </Text>
            </Box>
          ))}
          {todos.length > maxVisibleTodos ? (
            <Box paddingLeft={2}>
              <Text dimColor>… and {todos.length - maxVisibleTodos} more</Text>
            </Box>
          ) : null}
        </Box>
      )}
    </Box>
  )
}
