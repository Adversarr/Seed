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
    const stream = useStreamStore.getState().streams['task-1']!
    expect(stream.chunks).toHaveLength(1)
    expect(stream.chunks[0]!.content).toBe('Hello')
    expect(stream.chunks[0]!.kind).toBe('text')
    expect(stream.completed).toBe(false)
  })

  it('merges stream_delta of same kind', () => {
    const store = useStreamStore.getState()
    store.handleUiEvent({ type: 'stream_delta', payload: { taskId: 'task-1', agentId: 'a', kind: 'text', content: 'Hello ' } })
    store.handleUiEvent({ type: 'stream_delta', payload: { taskId: 'task-1', agentId: 'a', kind: 'text', content: 'World' } })
    const stream = useStreamStore.getState().streams['task-1']!
    expect(stream.chunks).toHaveLength(1)
    expect(stream.chunks[0]!.content).toBe('Hello World')
  })

  it('creates new chunk when kind changes', () => {
    const store = useStreamStore.getState()
    store.handleUiEvent({ type: 'stream_delta', payload: { taskId: 'task-1', agentId: 'a', kind: 'text', content: 'Text' } })
    store.handleUiEvent({ type: 'stream_delta', payload: { taskId: 'task-1', agentId: 'a', kind: 'reasoning', content: 'Thinking...' } })
    const stream = useStreamStore.getState().streams['task-1']!
    expect(stream.chunks).toHaveLength(2)
    expect(stream.chunks[0]!.kind).toBe('text')
    expect(stream.chunks[1]!.kind).toBe('reasoning')
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

  it('marks stream as completed on stream_end (preserves output)', () => {
    const store = useStreamStore.getState()
    store.handleUiEvent({ type: 'stream_delta', payload: { taskId: 'task-1', agentId: 'a', kind: 'text', content: 'done' } })
    expect(useStreamStore.getState().streams['task-1']!.completed).toBe(false)
    store.handleUiEvent({ type: 'stream_end', payload: { taskId: 'task-1', agentId: 'a' } })
    // Stream data should be preserved but marked completed
    const stream = useStreamStore.getState().streams['task-1']!
    expect(stream).toBeDefined()
    expect(stream.completed).toBe(true)
    expect(stream.chunks).toHaveLength(1)
    expect(stream.chunks[0]!.content).toBe('done')
  })
})
