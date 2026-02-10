/**
 * WebSocket service — connects to the CoAuthor backend for real-time events.
 *
 * Features:
 * - Auto-reconnect with exponential backoff
 * - Gap-filling via lastEventId
 * - Typed event callbacks
 */

import type { StoredEvent, UiEvent, WsClientMessage, WsServerMessage } from '@/types'

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected'

export interface WsCallbacks {
  onEvent?: (event: StoredEvent) => void
  onUiEvent?: (event: UiEvent) => void
  onStatusChange?: (status: ConnectionStatus) => void
}

export class WsService {
  #ws: WebSocket | null = null
  #callbacks: WsCallbacks
  #lastEventId = 0
  #reconnectTimer: ReturnType<typeof setTimeout> | null = null
  #reconnectDelay = 1000
  #disposed = false
  #subscribedChannels: ('events' | 'ui')[] = ['events', 'ui']

  constructor(callbacks: WsCallbacks) {
    this.#callbacks = callbacks
  }

  connect(): void {
    if (this.#disposed) return
    const token = sessionStorage.getItem('coauthor-token') ?? ''
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const url = `${protocol}//${location.host}/ws?token=${token}`

    this.#callbacks.onStatusChange?.('connecting')

    const ws = new WebSocket(url)
    this.#ws = ws

    ws.onopen = () => {
      this.#callbacks.onStatusChange?.('connected')
      this.#reconnectDelay = 1000
      // Subscribe with gap-fill
      const msg: WsClientMessage = {
        type: 'subscribe',
        channels: this.#subscribedChannels,
        lastEventId: this.#lastEventId,
      }
      ws.send(JSON.stringify(msg))
    }

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data as string) as WsServerMessage
        switch (msg.type) {
          case 'event':
            this.#lastEventId = Math.max(this.#lastEventId, msg.data.id)
            this.#callbacks.onEvent?.(msg.data)
            break
          case 'ui_event':
            this.#callbacks.onUiEvent?.(msg.data)
            break
          case 'subscribed':
          case 'pong':
            break
          case 'error':
            console.warn('[ws] server error:', msg.code, msg.message)
            break
        }
      } catch {
        console.warn('[ws] failed to parse message')
      }
    }

    ws.onclose = () => {
      this.#callbacks.onStatusChange?.('disconnected')
      this.#scheduleReconnect()
    }

    ws.onerror = () => {
      ws.close()
    }
  }

  disconnect(): void {
    this.#disposed = true
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer)
    this.#ws?.close()
    this.#ws = null
  }

  get lastEventId(): number { return this.#lastEventId }
  set lastEventId(id: number) { this.#lastEventId = id }

  #scheduleReconnect(): void {
    if (this.#disposed) return
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectDelay = Math.min(this.#reconnectDelay * 2, 30_000)
      this.connect()
    }, this.#reconnectDelay)
  }
}
