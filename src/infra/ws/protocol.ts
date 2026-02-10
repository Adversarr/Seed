/**
 * WebSocket Protocol — typed message schemas for client ↔ server communication.
 *
 * Design: Zod-validated, discriminated union messages.
 * Channels: 'events' (StoredEvent stream), 'ui' (UiEvent stream).
 */

import { z } from 'zod'

// ============================================================================
// Channel Definitions
// ============================================================================

export const ChannelSchema = z.enum(['events', 'ui'])
export type Channel = z.infer<typeof ChannelSchema>

// ============================================================================
// Client → Server Messages
// ============================================================================

export const SubscribeMessageSchema = z.object({
  type: z.literal('subscribe'),
  channels: z.array(ChannelSchema).min(1),
  /** Optional: filter events channel to a single stream (taskId). */
  streamId: z.string().optional(),
  /** Optional: replay events after this ID for gap-filling on reconnect. */
  lastEventId: z.number().int().nonnegative().optional(),
})

export const UnsubscribeMessageSchema = z.object({
  type: z.literal('unsubscribe'),
  channels: z.array(ChannelSchema).min(1),
  streamId: z.string().optional(),
})

export const PingMessageSchema = z.object({
  type: z.literal('ping'),
})

export const ClientMessageSchema = z.discriminatedUnion('type', [
  SubscribeMessageSchema,
  UnsubscribeMessageSchema,
  PingMessageSchema,
])

export type ClientMessage = z.infer<typeof ClientMessageSchema>
export type SubscribeMessage = z.infer<typeof SubscribeMessageSchema>
export type UnsubscribeMessage = z.infer<typeof UnsubscribeMessageSchema>

// ============================================================================
// Server → Client Messages
// ============================================================================

/** Domain event broadcast (events channel). */
export type EventMessage = {
  type: 'event'
  data: unknown // StoredEvent — kept as `unknown` here to avoid circular dep; serialized as JSON
}

/** UI event broadcast (ui channel). */
export type UiEventMessage = {
  type: 'ui_event'
  data: unknown // UiEvent
}

/** Subscription acknowledgment. */
export type SubscribedMessage = {
  type: 'subscribed'
  channels: Channel[]
}

/** Error notification. */
export type ErrorMessage = {
  type: 'error'
  code: string
  message: string
}

/** Heartbeat response. */
export type PongMessage = {
  type: 'pong'
}

export type ServerMessage =
  | EventMessage
  | UiEventMessage
  | SubscribedMessage
  | ErrorMessage
  | PongMessage

// ============================================================================
// Helpers
// ============================================================================

export function parseClientMessage(raw: string): ClientMessage {
  return ClientMessageSchema.parse(JSON.parse(raw))
}

export function serializeServerMessage(msg: ServerMessage): string {
  return JSON.stringify(msg)
}
