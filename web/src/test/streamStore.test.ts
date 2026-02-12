/**
 * Tests for the stream store.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
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
    const stream = useStreamStore.getState().streams['task-1']!
    expect(stream).toBeDefined()
    expect(stream.completed).toBe(true)
    expect(stream.chunks).toHaveLength(1)
    expect(stream.chunks[0]!.content).toBe('done')
  })

  it('updates running tool chunk on tool_call_heartbeat', () => {
    const store = useStreamStore.getState()
    store.handleUiEvent({
      type: 'tool_call_start',
      payload: {
        taskId: 'task-1',
        agentId: 'a',
        toolCallId: 'tc-1',
        toolName: 'readFile',
        arguments: {},
      },
    })

    store.handleUiEvent({
      type: 'tool_call_heartbeat',
      payload: {
        taskId: 'task-1',
        agentId: 'a',
        toolCallId: 'tc-1',
        toolName: 'readFile',
        elapsedMs: 4_200,
      },
    })

    const stream = useStreamStore.getState().streams['task-1']!
    expect(stream.chunks).toHaveLength(1)
    expect(stream.chunks[0]!.kind).toBe('tool_call')
    expect(stream.chunks[0]!.content).toContain('Running readFile')
    expect(stream.chunks[0]!.content).toContain('(4s)')
  })

  it('adds a fallback verbose chunk when heartbeat arrives before tool_call_start', () => {
    useStreamStore.getState().handleUiEvent({
      type: 'tool_call_heartbeat',
      payload: {
        taskId: 'task-1',
        agentId: 'a',
        toolCallId: 'tc-1',
        toolName: 'readFile',
        elapsedMs: 1_000,
      },
    })

    const stream = useStreamStore.getState().streams['task-1']!
    expect(stream.chunks).toHaveLength(1)
    expect(stream.chunks[0]!.kind).toBe('verbose')
    expect(stream.chunks[0]!.content).toContain('Running readFile')
  })
})

describe('streamStore — payload validation (Task 4)', () => {
  beforeEach(() => {
    useStreamStore.setState({ streams: {} })
  })

  it('ignores stream_delta with empty taskId', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    useStreamStore.getState().handleUiEvent({
      type: 'stream_delta',
      payload: { taskId: '', agentId: 'a', kind: 'text', content: 'test' },
    })
    expect(useStreamStore.getState().streams['']).toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('ignores stream_delta with missing taskId', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    useStreamStore.getState().handleUiEvent({
      type: 'stream_delta',
      payload: { agentId: 'a', kind: 'text', content: 'test' } as never,
    })
    expect(Object.keys(useStreamStore.getState().streams)).toHaveLength(0)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('ignores stream_end with empty taskId', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    useStreamStore.getState().handleUiEvent({
      type: 'stream_end',
      payload: { taskId: '', agentId: 'a' },
    })
    expect(Object.keys(useStreamStore.getState().streams)).toHaveLength(0)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('processes valid stream_delta normally', () => {
    useStreamStore.getState().handleUiEvent({
      type: 'stream_delta',
      payload: { taskId: 'task-valid', agentId: 'a', kind: 'text', content: 'valid content' },
    })
    const stream = useStreamStore.getState().streams['task-valid']
    expect(stream).toBeDefined()
    expect(stream!.chunks).toHaveLength(1)
    expect(stream!.chunks[0]!.content).toBe('valid content')
  })
})
