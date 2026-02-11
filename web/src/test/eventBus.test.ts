/**
 * Tests for the EventBus pub/sub module.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { eventBus } from '@/stores/eventBus'
import type { StoredEvent, UiEvent } from '@/types'

describe('EventBus', () => {
  beforeEach(() => {
    eventBus.clear()
  })

  it('delivers domain-event to subscriber', () => {
    const handler = vi.fn()
    eventBus.on('domain-event', handler)

    const event = { id: 1, streamId: 's1', seq: 1, type: 'TaskCreated', payload: {}, createdAt: '' } as StoredEvent
    eventBus.emit('domain-event', event)

    expect(handler).toHaveBeenCalledOnce()
    expect(handler).toHaveBeenCalledWith(event)
  })

  it('delivers ui-event to subscriber', () => {
    const handler = vi.fn()
    eventBus.on('ui-event', handler)

    const event: UiEvent = { type: 'stream_delta', payload: { taskId: 't1', agentId: 'a1', kind: 'text', content: 'hi' } }
    eventBus.emit('ui-event', event)

    expect(handler).toHaveBeenCalledOnce()
  })

  it('returns unsubscribe function', () => {
    const handler = vi.fn()
    const unsub = eventBus.on('domain-event', handler)

    unsub()
    eventBus.emit('domain-event', {} as StoredEvent)

    expect(handler).not.toHaveBeenCalled()
  })

  it('supports multiple handlers', () => {
    const h1 = vi.fn()
    const h2 = vi.fn()
    eventBus.on('domain-event', h1)
    eventBus.on('domain-event', h2)

    eventBus.emit('domain-event', {} as StoredEvent)

    expect(h1).toHaveBeenCalledOnce()
    expect(h2).toHaveBeenCalledOnce()
  })

  it('does not deliver to wrong channel', () => {
    const handler = vi.fn()
    eventBus.on('domain-event', handler)

    eventBus.emit('ui-event', {} as UiEvent)

    expect(handler).not.toHaveBeenCalled()
  })

  it('clear() removes all handlers', () => {
    const h1 = vi.fn()
    const h2 = vi.fn()
    eventBus.on('domain-event', h1)
    eventBus.on('ui-event', h2)

    eventBus.clear()
    eventBus.emit('domain-event', {} as StoredEvent)
    eventBus.emit('ui-event', {} as UiEvent)

    expect(h1).not.toHaveBeenCalled()
    expect(h2).not.toHaveBeenCalled()
  })

  it('survives handler errors without breaking other handlers', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const badHandler = vi.fn(() => { throw new Error('boom') })
    const goodHandler = vi.fn()

    eventBus.on('domain-event', badHandler)
    eventBus.on('domain-event', goodHandler)

    eventBus.emit('domain-event', {} as StoredEvent)

    expect(badHandler).toHaveBeenCalled()
    expect(goodHandler).toHaveBeenCalled()
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
