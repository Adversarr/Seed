/**
 * TaskTree tests.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { useTaskStore } from '@/stores/taskStore'
import { TaskTree } from '@/components/navigation/TaskTree'
import type { TaskView } from '@/types'

function makeTask(overrides: Partial<TaskView>): TaskView {
  return {
    taskId: 'task-1',
    title: 'Test Task',
    intent: '',
    createdBy: 'user',
    agentId: 'agent-1',
    priority: 'normal',
    status: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

describe('TaskTree', () => {
  beforeEach(() => {
    useTaskStore.setState({ tasks: [], loading: false, error: null })
  })

  it('stores support parent-child task relationships', () => {
    const parent = makeTask({ taskId: 'p1', title: 'Parent' })
    const child = makeTask({ taskId: 'c1', title: 'Child', parentTaskId: 'p1' })
    useTaskStore.setState({ tasks: [parent, child] })

    const tasks = useTaskStore.getState().tasks
    expect(tasks).toHaveLength(2)
    expect(tasks.find(t => t.taskId === 'c1')?.parentTaskId).toBe('p1')
  })

  it('renders hierarchy and status from task projection only', () => {
    const parent = makeTask({ taskId: 'p1', title: 'Parent', status: 'in_progress' })
    const child = makeTask({ taskId: 'c1', title: 'Child', parentTaskId: 'p1', status: 'awaiting_user' })
    useTaskStore.setState({ tasks: [parent, child] })

    render(
      <MemoryRouter>
        <TaskTree activeTaskId="p1" />
      </MemoryRouter>,
    )

    expect(screen.getByText('Parent')).toBeInTheDocument()
    expect(screen.getByText('Child')).toBeInTheDocument()
    expect(screen.getByText('Running')).toBeInTheDocument()
    expect(screen.getByText('Awaiting User')).toBeInTheDocument()
  })

  it('shows empty state when there are no tasks', () => {
    render(
      <MemoryRouter>
        <TaskTree />
      </MemoryRouter>,
    )

    expect(screen.getByText('No tasks')).toBeInTheDocument()
  })
})
