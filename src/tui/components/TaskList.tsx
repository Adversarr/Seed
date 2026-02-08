import React from 'react'
import { Box, Text } from 'ink'
import type { TaskView } from '../types.js'
import { truncateText, getStatusIcon } from '../utils.js'

type Props = {
  tasks: TaskView[]
  focusedTaskId: string | null
  selectedTaskIndex: number
  rows: number
  columns: number
  statusLine: string
}

export function TaskList({ tasks, focusedTaskId, selectedTaskIndex, rows, columns, statusLine }: Props) {
  const maximumTaskRows = Math.max(0, rows - 7)
  const visibleTasks = tasks.slice(0, maximumTaskRows)
  const hiddenTaskCount = Math.max(0, tasks.length - visibleTasks.length)

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="double" borderColor="white" flexDirection="column" padding={1}>
        <Text bold underline>
          Tasks (Press ESC to close)
        </Text>
        <Text dimColor>{statusLine || ' '}</Text>
        <Box flexDirection="column" marginTop={1}>
          {visibleTasks.map((task) => {
            const isFocused = task.taskId === focusedTaskId
            const isSelected = tasks.indexOf(task) === selectedTaskIndex
            const taskSuffix = ` (${task.status}) [${task.taskId}]`
            const availableTitleWidth = Math.max(0, columns - taskSuffix.length - 6)
            const truncatedTitle = truncateText(task.title, availableTitleWidth)

            return (
              <Box key={task.taskId}>
                <Text color={isFocused ? 'green' : isSelected ? 'blue' : 'white'} bold={isFocused || isSelected}>
                  {isSelected ? '> ' : '  '}
                  {truncatedTitle}
                </Text>
                <Text dimColor>{` ${getStatusIcon(task.status)}${taskSuffix}`}</Text>
              </Box>
            )
          })}
          {hiddenTaskCount > 0 ? (
            <Text dimColor>{`… and ${hiddenTaskCount} more`}</Text>
          ) : null}
        </Box>
      </Box>
    </Box>
  )
}
