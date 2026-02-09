import React from 'react'
import { Box, Text } from 'ink'
import type { TaskView } from '../types.js'
import {
  truncateText,
  getStatusIcon,
  getStatusLabel,
  getTreePrefix,
  getChildStatusSummary
} from '../utils.js'

type Props = {
  tasks: TaskView[]
  focusedTaskId: string | null
  selectedTaskIndex: number
  rows: number
  columns: number
  statusLine: string
  breadcrumb?: string[]
}

/** Depth-based colors for agent badges. */
const DEPTH_COLORS = ['cyan', 'magenta', 'yellow', 'blue', 'green'] as const
function depthColor(depth: number): string {
  return DEPTH_COLORS[depth % DEPTH_COLORS.length]
}

/** Agent-specific badge colors */
const AGENT_COLORS: Record<string, string> = {
  default: 'cyan',
  search: 'yellow',
  minimal: 'green',
}
function agentColor(agentId: string): string {
  const short = agentId.replace(/^agent_/, '')
  return AGENT_COLORS[short] ?? depthColor(0)
}

export function TaskList({
  tasks,
  focusedTaskId,
  selectedTaskIndex,
  rows,
  columns,
  statusLine,
  breadcrumb
}: Props) {
  const maximumTaskRows = Math.max(0, rows - 9)
  const visibleTasks = tasks.slice(0, maximumTaskRows)
  const hiddenTaskCount = Math.max(0, tasks.length - visibleTasks.length)
  const breadcrumbText = breadcrumb && breadcrumb.length > 1 ? breadcrumb.join(' › ') : ''

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box borderStyle="double" borderColor="white" flexDirection="column" padding={1}>
        {/* Header */}
        <Box>
          <Text bold underline color="cyan">
            Tasks
          </Text>
          <Text dimColor>
            {' '}({tasks.length})  ESC close │ ↑↓ nav │ Enter focus │ Tab toggle
          </Text>
        </Box>

        {/* Breadcrumb trail */}
        {breadcrumbText ? (
          <Text color="yellow" dimColor>
            ▸ {breadcrumbText}
          </Text>
        ) : null}

        <Text dimColor>{statusLine || ' '}</Text>

        {/* Task rows */}
        <Box flexDirection="column" marginTop={1}>
          {visibleTasks.map((task, visibleIndex) => {
            const globalIndex = visibleIndex  // visibleTasks starts at index 0
            const isFocused = task.taskId === focusedTaskId
            const isSelected = globalIndex === selectedTaskIndex
            const treePrefix = getTreePrefix(task, tasks, task.depth)
            const agentTag = `[${task.agentId.replace(/^agent_/, '')}]`
            const statusIcon = getStatusIcon(task.status)
            const statusLabel = getStatusLabel(task.status)
            const childSummary = getChildStatusSummary(task, tasks)
            const isSubtask = task.depth > 0
            const isTerminal = ['done', 'failed', 'canceled'].includes(task.status)

            // Calculate available width for title
            const fixedParts = `  ${treePrefix}${agentTag} ` + ` ${statusIcon} ${statusLabel}`
            const suffixParts = childSummary ? ` (${childSummary})` : ''
            const idSuffix = ` [${task.taskId.slice(0, 8)}]`
            const availableTitleWidth = Math.max(8, columns - fixedParts.length - suffixParts.length - idSuffix.length - 6)
            const truncatedTitle = truncateText(task.title, availableTitleWidth)

            // Colors based on state
            const titleColor = isFocused ? 'green' : isSelected ? 'blue' : isTerminal ? 'gray' : 'white'
            const isBold = isFocused || isSelected
            const isDim = isTerminal && !isFocused && !isSelected

            return (
              <Box key={task.taskId}>
                <Text color={titleColor} bold={isBold} dimColor={isDim}>
                  {isSelected ? '▸ ' : '  '}
                  {treePrefix}
                </Text>
                <Text color={agentColor(task.agentId)} dimColor={isDim}>
                  {agentTag}
                </Text>
                <Text color={titleColor} bold={isBold} dimColor={isDim}>
                  {' '}{truncatedTitle}
                </Text>
                <Text dimColor={isDim}>
                  {' '}{statusIcon} <Text color={isSubtask ? depthColor(task.depth) : 'yellow'}>{statusLabel}</Text>
                </Text>
                {childSummary ? (
                  <Text color="cyan" dimColor> ({childSummary})</Text>
                ) : null}
                <Text dimColor> {idSuffix}</Text>
              </Box>
            )
          })}
          {hiddenTaskCount > 0 ? (
            <Text dimColor>{`  … and ${hiddenTaskCount} more`}</Text>
          ) : null}
        </Box>
      </Box>
    </Box>
  )
}
