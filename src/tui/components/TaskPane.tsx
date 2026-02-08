import React from 'react'
import type { TaskView } from '../types.js'
import { TaskList } from './TaskList.js'

type Props = {
  tasks: TaskView[]
  focusedTaskId: string | null
  selectedTaskIndex: number
  rows: number
  columns: number
  statusLine: string
}

export function TaskPane({
  tasks,
  focusedTaskId,
  selectedTaskIndex,
  rows,
  columns,
  statusLine
}: Props) {
  return (
    <TaskList
      tasks={tasks}
      focusedTaskId={focusedTaskId}
      selectedTaskIndex={selectedTaskIndex}
      rows={rows}
      columns={columns}
      statusLine={statusLine}
    />
  )
}
