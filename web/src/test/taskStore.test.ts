/**
 * Tests for the task store.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useTaskStore } from '@/stores/taskStore'
import type { StoredEvent, TaskView } from '@/types'

function makeStoredEvent(overrides: Partial<StoredEvent> & Pick<StoredEvent, 'type' | 'payload'>): StoredEvent {
  return {
    id: 1,
    streamId: 'task-1',
    seq: 1,
    createdAt: new Date().toISOString(),
    ...overrides,
  } as StoredEvent
}

describe('taskStore', () => {
  beforeEach(() => {
    useTaskStore.setState({ tasks: [], loading: false, error: null })
  })

  it('starts with empty state', () => {
    const { tasks, loading, error } = useTaskStore.getState()
    expect(tasks).toEqual([])
    expect(loading).toBe(false)
    expect(error).toBeNull()
  })

  it('applies TaskCreated event', () => {
    useTaskStore.getState().applyEvent(
      makeStoredEvent({
        type: 'TaskCreated',
        streamId: 'task-1',
        payload: { taskId: 'task-1', title: 'Test', intent: '', agentId: 'default', authorActorId: 'user-1', priority: 'foreground' },
      })
    )
    const tasks = useTaskStore.getState().tasks
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.taskId).toBe('task-1')
    expect(tasks[0]!.title).toBe('Test')
    expect(tasks[0]!.status).toBe('open')
  })

  it('avoids duplicate TaskCreated', () => {
    const event = makeStoredEvent({
      type: 'TaskCreated',
      streamId: 'task-1',
      payload: { taskId: 'task-1', title: 'Test', intent: '', agentId: 'default', authorActorId: 'user-1' },
    })
    useTaskStore.getState().applyEvent(event)
    useTaskStore.getState().applyEvent(event)
    expect(useTaskStore.getState().tasks).toHaveLength(1)
  })

  it('transitions TaskStarted → in_progress', () => {
    useTaskStore.getState().applyEvent(
      makeStoredEvent({
        type: 'TaskCreated', streamId: 'task-1',
        payload: { taskId: 'task-1', title: 'Test', intent: '', agentId: 'default', authorActorId: 'user-1' },
      })
    )
    useTaskStore.getState().applyEvent(
      makeStoredEvent({
        id: 2, type: 'TaskStarted', streamId: 'task-1',
        payload: { taskId: 'task-1', agentId: 'default', authorActorId: 'user-1' },
      })
    )
    expect(useTaskStore.getState().tasks[0]!.status).toBe('in_progress')
  })

  it('transitions TaskCompleted → done with summary', () => {
    useTaskStore.setState({ tasks: [{ taskId: 'task-1', status: 'in_progress' } as TaskView] })
    useTaskStore.getState().applyEvent(
      makeStoredEvent({
        type: 'TaskCompleted', streamId: 'task-1',
        payload: { taskId: 'task-1', summary: 'All done', authorActorId: 'user-1' },
      })
    )
    const t = useTaskStore.getState().tasks[0]!
    expect(t.status).toBe('done')
    expect(t.summary).toBe('All done')
  })

  it('transitions TaskFailed → failed with reason', () => {
    useTaskStore.setState({ tasks: [{ taskId: 'task-1', status: 'in_progress' } as TaskView] })
    useTaskStore.getState().applyEvent(
      makeStoredEvent({
        type: 'TaskFailed', streamId: 'task-1',
        payload: { taskId: 'task-1', reason: 'Timeout', authorActorId: 'user-1' },
      })
    )
    const t = useTaskStore.getState().tasks[0]!
    expect(t.status).toBe('failed')
    expect(t.failureReason).toBe('Timeout')
  })

  it('transitions TaskCanceled → canceled', () => {
    useTaskStore.setState({ tasks: [{ taskId: 'task-1', status: 'open' } as TaskView] })
    useTaskStore.getState().applyEvent(
      makeStoredEvent({ type: 'TaskCanceled', streamId: 'task-1', payload: { taskId: 'task-1', authorActorId: 'user-1' } })
    )
    expect(useTaskStore.getState().tasks[0]!.status).toBe('canceled')
  })

  it('transitions UserInteractionRequested → awaiting_user', () => {
    useTaskStore.setState({ tasks: [{ taskId: 'task-1', status: 'in_progress' } as TaskView] })
    useTaskStore.getState().applyEvent(
      makeStoredEvent({
        type: 'UserInteractionRequested', streamId: 'task-1',
        payload: { interactionId: 'int-1', taskId: 'task-1', authorActorId: 'user-1' },
      })
    )
    const t = useTaskStore.getState().tasks[0]!
    expect(t.status).toBe('awaiting_user')
    expect(t.pendingInteractionId).toBe('int-1')
  })

  it('transitions UserInteractionResponded → in_progress', () => {
    useTaskStore.setState({ tasks: [{ taskId: 'task-1', status: 'awaiting_user', pendingInteractionId: 'int-1' } as TaskView] })
    useTaskStore.getState().applyEvent(
      makeStoredEvent({
        type: 'UserInteractionResponded', streamId: 'task-1',
        payload: { interactionId: 'int-1', taskId: 'task-1', authorActorId: 'user-1' },
      })
    )
    const t = useTaskStore.getState().tasks[0]!
    expect(t.status).toBe('in_progress')
    expect(t.pendingInteractionId).toBeUndefined()
  })
})
