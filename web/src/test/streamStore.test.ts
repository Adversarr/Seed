/**
 * Tests for the stream store.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { useStreamStore } from '@/stores/streamStore'
import type { UiEvent } from '@/types'

describe('streamStore', () => {
  beforeEach(() => {
    useStreamStore.setState({ streams: {} })
  })

  it('accumulates agent_output chunks', () => {
    const event: UiEvent = {
      type: 'agent_output',
      payload: { taskId: 'task-1', agentId: 'agent-1', kind: 'text', content: 'Hello' },
    }
    useStreamStore.getState().handleUiEvent(event)
    const chunks = useStreamStore.getState().streams['task-1']!
    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.content).toBe('Hello')
    expect(chunks[0]!.kind).toBe('text')
  })

  it('merges stream_delta of same kind', () => {
    const store = useStreamStore.getState()
    store.handleUiEvent({ type: 'stream_delta', payload: { taskId: 'task-1', agentId: 'a', kind: 'text', content: 'Hello ' } })
    store.handleUiEvent({ type: 'stream_delta', payload: { taskId: 'task-1', agentId: 'a', kind: 'text', content: 'World' } })
    const chunks = useStreamStore.getState().streams['task-1']!
    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.content).toBe('Hello World')
  })

  it('creates new chunk when kind changes', () => {
    const store = useStreamStore.getState()
    store.handleUiEvent({ type: 'stream_delta', payload: { taskId: 'task-1', agentId: 'a', kind: 'text', content: 'Text' } })
    store.handleUiEvent({ type: 'stream_delta', payload: { taskId: 'task-1', agentId: 'a', kind: 'reasoning', content: 'Thinking...' } })
    const chunks = useStreamStore.getState().streams['task-1']!
    expect(chunks).toHaveLength(2)
    expect(chunks[0]!.kind).toBe('text')
    expect(chunks[1]!.kind).toBe('reasoning')
  })

  it('clearStream removes task data', () => {
    useStreamStore.getState().handleUiEvent({
      type: 'agent_output',
      payload: { taskId: 'task-1', agentId: 'a', kind: 'text', content: 'x' },
    })
    expect(useStreamStore.getState().streams['task-1']).toBeDefined()
    useStreamStore.getState().clearStream('task-1')
    expect(useStreamStore.getState().streams['task-1']).toBeUndefined()
  })

  it('handles stream_end gracefully', () => {
    const store = useStreamStore.getState()
    store.handleUiEvent({ type: 'stream_delta', payload: { taskId: 'task-1', agentId: 'a', kind: 'text', content: 'done' } })
    store.handleUiEvent({ type: 'stream_end', payload: { taskId: 'task-1', agentId: 'a' } })
    // Stream data should still be there
    expect(useStreamStore.getState().streams['task-1']).toHaveLength(1)
  })
})
