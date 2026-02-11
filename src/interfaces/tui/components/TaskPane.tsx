import React from 'react'
import type { TaskView } from '../types.js'
import { TaskList } from './TaskList.js'
import { TaskDetail } from './TaskDetail.js'

type Props = {
  tasks: TaskView[]
  focusedTaskId: string | null
  selectedTaskIndex: number
  rows: number
  columns: number
  statusLine: string
  breadcrumb?: string[]
}

export function TaskPane({
  tasks,
  focusedTaskId,
  selectedTaskIndex,
  rows,
  columns,
  statusLine,
  breadcrumb
}: Props) {
  const selectedTask = tasks[selectedTaskIndex]

  return (
    <>
      <TaskList
        tasks={tasks}
        focusedTaskId={focusedTaskId}
        selectedTaskIndex={selectedTaskIndex}
        rows={selectedTask ? Math.max(8, rows - 10) : rows}
        columns={columns}
        statusLine={statusLine}
        breadcrumb={breadcrumb}
      />
      {selectedTask ? (
        <TaskDetail task={selectedTask} allTasks={tasks} columns={columns} />
      ) : null}
    </>
  )
}
