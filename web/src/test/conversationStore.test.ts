/**
 * Tests for the conversation store.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useConversationStore, registerConversationSubscriptions, unregisterConversationSubscriptions } from '@/stores/conversationStore'
import { eventBus } from '@/stores/eventBus'
import type { StoredEvent } from '@/types'

function makeEvent(id: number, type: string, payload: Record<string, unknown>): StoredEvent {
  return {
    id,
    streamId: 'task-1',
    seq: id,
    type: type as StoredEvent['type'],
    payload,
    createdAt: new Date().toISOString(),
  } as StoredEvent
}

describe('conversationStore', () => {
  beforeEach(() => {
    useConversationStore.setState({ conversations: {}, loadingTasks: new Set() })
    unregisterConversationSubscriptions()
    eventBus.clear()
    registerConversationSubscriptions()
  })

  it('starts with empty conversations', () => {
    const { conversations } = useConversationStore.getState()
    expect(Object.keys(conversations)).toHaveLength(0)
  })

  it('getMessages returns empty array for unknown task', () => {
    const store = useConversationStore.getState()
    const msgs1 = store.getMessages('unknown')
    const msgs2 = store.getMessages('unknown')
    expect(msgs1).toEqual([])
    expect(msgs1).toBe(msgs2)
  })

  it('clearConversation removes task data', () => {
    useConversationStore.setState({
      conversations: { 'task-1': [{ id: 'x', role: 'system', kind: 'status', content: 'hi', timestamp: '' }] },
    })
    useConversationStore.getState().clearConversation('task-1')
    expect(useConversationStore.getState().conversations['task-1']).toBeUndefined()
  })

  it('appends real-time events to already-loaded conversation via eventBus', () => {
    useConversationStore.setState({
      conversations: {
        'task-1': [{ id: '1-created', role: 'system', kind: 'status', content: 'Task created: Test', timestamp: '' }],
      },
    })

    const event = makeEvent(2, 'TaskStarted', { taskId: 'task-1' })
    eventBus.emit('domain-event', event)

    const msgs = useConversationStore.getState().getMessages('task-1')
    expect(msgs).toHaveLength(2)
    expect(msgs[1]!.content).toBe('Agent started working')
  })

  it('ignores events for tasks without loaded conversations', () => {
    useConversationStore.setState({ conversations: {} })

    const event = makeEvent(3, 'TaskStarted', { taskId: 'task-unknown' })
    eventBus.emit('domain-event', event)

    const msgs = useConversationStore.getState().getMessages('task-unknown')
    expect(msgs).toHaveLength(0)
  })

  it('deduplicates events by message id', () => {
    useConversationStore.setState({
      conversations: {
        'task-1': [{ id: '1-started', role: 'system', kind: 'status', content: 'Agent started working', timestamp: '' }],
      },
    })

    const event = makeEvent(1, 'TaskStarted', { taskId: 'task-1' })
    eventBus.emit('domain-event', event)
    eventBus.emit('domain-event', event)

    const msgs = useConversationStore.getState().getMessages('task-1')
    expect(msgs).toHaveLength(1)
  })
})
