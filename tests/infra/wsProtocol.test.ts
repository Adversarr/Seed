/**
 * Tests for WebSocket protocol message parsing and serialization.
 */

import { describe, it, expect } from 'vitest'
import {
  parseClientMessage,
  serializeServerMessage,
  ClientMessageSchema,
  type ServerMessage,
} from '../../src/infra/ws/protocol.js'

describe('WS Protocol', () => {
  describe('parseClientMessage', () => {
    it('parses subscribe message', () => {
      const raw = JSON.stringify({ type: 'subscribe', channels: ['events'] })
      const msg = parseClientMessage(raw)
      expect(msg).toEqual({ type: 'subscribe', channels: ['events'] })
    })

    it('parses subscribe with streamId and lastEventId', () => {
      const raw = JSON.stringify({ type: 'subscribe', channels: ['events', 'ui'], streamId: 'task-1', lastEventId: 42 })
      const msg = parseClientMessage(raw)
      expect(msg).toEqual({ type: 'subscribe', channels: ['events', 'ui'], streamId: 'task-1', lastEventId: 42 })
    })

    it('parses unsubscribe message', () => {
      const raw = JSON.stringify({ type: 'unsubscribe', channels: ['ui'] })
      const msg = parseClientMessage(raw)
      expect(msg).toEqual({ type: 'unsubscribe', channels: ['ui'] })
    })

    it('parses ping message', () => {
      const raw = JSON.stringify({ type: 'ping' })
      const msg = parseClientMessage(raw)
      expect(msg).toEqual({ type: 'ping' })
    })

    it('rejects unknown type', () => {
      const raw = JSON.stringify({ type: 'unknown' })
      expect(() => parseClientMessage(raw)).toThrow()
    })

    it('rejects empty channels', () => {
      const raw = JSON.stringify({ type: 'subscribe', channels: [] })
      expect(() => parseClientMessage(raw)).toThrow()
    })

    it('rejects invalid channel name', () => {
      const raw = JSON.stringify({ type: 'subscribe', channels: ['invalid'] })
      expect(() => parseClientMessage(raw)).toThrow()
    })

    it('rejects malformed JSON', () => {
      expect(() => parseClientMessage('not json')).toThrow()
    })

    it('rejects negative lastEventId', () => {
      const raw = JSON.stringify({ type: 'subscribe', channels: ['events'], lastEventId: -1 })
      expect(() => parseClientMessage(raw)).toThrow()
    })
  })

  describe('ClientMessageSchema validation', () => {
    it('validates all valid channel combinations', () => {
      for (const channels of [['events'], ['ui'], ['events', 'ui']]) {
        expect(ClientMessageSchema.parse({ type: 'subscribe', channels })).toBeDefined()
      }
    })
  })

  describe('serializeServerMessage', () => {
    it('serializes event message', () => {
      const msg: ServerMessage = { type: 'event', data: { id: 1, type: 'TaskCreated' } }
      const json = serializeServerMessage(msg)
      expect(JSON.parse(json)).toEqual(msg)
    })

    it('serializes pong', () => {
      const msg: ServerMessage = { type: 'pong' }
      expect(JSON.parse(serializeServerMessage(msg))).toEqual({ type: 'pong' })
    })

    it('serializes error', () => {
      const msg: ServerMessage = { type: 'error', code: 'TEST', message: 'failure' }
      expect(JSON.parse(serializeServerMessage(msg))).toEqual(msg)
    })

    it('serializes subscribed', () => {
      const msg: ServerMessage = { type: 'subscribed', channels: ['events', 'ui'] }
      expect(JSON.parse(serializeServerMessage(msg))).toEqual(msg)
    })
  })
})
