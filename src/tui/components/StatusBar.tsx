import React from 'react'
import { Box, Text } from 'ink'
import type { TaskView } from '../types.js'
import { getStatusIcon, createSeparatorLine } from '../utils.js'

type Props = {
  focusedTask: TaskView | undefined
  columns: number
}

export function StatusBar({ focusedTask, columns }: Props) {
  const separatorLine = createSeparatorLine(columns)
  const taskTitle = focusedTask ? focusedTask.title : '(no task focused)'
  const taskStatus = focusedTask ? focusedTask.status : ''
  const statusIcon = getStatusIcon(taskStatus)

  return (
    <>
      <Text dimColor>{separatorLine}</Text>
      <Box height={1} width="100%" paddingX={1}>
        <Box flexGrow={1}>
          <Text color="cyan" bold>
            CoAuthor
          </Text>
          <Text dimColor> │ </Text>
          <Text color="yellow">FOCUSED: </Text>
          <Text bold>{taskTitle}</Text>
          <Text> {statusIcon} </Text>
        </Box>
        <Text color="green">[●]</Text>
      </Box>
    </>
  )
}
