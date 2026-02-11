/**
 * WebSocket Server — real-time event fanout to browser and remote TUI clients.
 *
 * Architecture:
 * - Attaches to an existing http.Server via `upgrade` event.
 * - Subscribes once to EventStore.events$ and UiBus.events$ globally.
 * - Per-connection subscription state: channels + optional streamId filter.
 * - Gap-filling: client sends lastEventId → server replays missed events.
 * - Heartbeat: server pongs on client pings; server-side idle detection via 60s timeout.
 */

import { WebSocketServer as WSServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'node:http'
import type { Server as HttpServer } from 'node:http'
import type { Subscribable, Subscription } from '../../../core/ports/subscribable.js'
import type { StoredEvent } from '../../../core/events/events.js'
import type { UiEvent } from '../../../core/ports/uiBus.js'
import {
  parseClientMessage,
  serializeServerMessage,
  type Channel,
  type ServerMessage,
} from './protocol.js'

// ============================================================================
// Types
// ============================================================================

export interface WsServerDeps {
  events$: Subscribable<StoredEvent>
  uiEvents$: Subscribable<UiEvent>
  /** Fetch events after a given ID (for gap-filling). */
  getEventsAfter: (fromIdExclusive: number) => Promise<StoredEvent[]>
  /** Auth token — must match `?token=` query param. */
  authToken: string
}

interface ClientState {
  channels: Set<Channel>
  /** If set, only events for this streamId are forwarded on the 'events' channel. */
  streamId: string | null
  /** Whether the client has responded to the last ping. */
  isAlive: boolean
}

// ============================================================================
// WebSocket Server
// ============================================================================

export class CoAuthorWsServer {
  readonly #wss: WSServer
  readonly #deps: WsServerDeps
  readonly #clients = new Map<WebSocket, ClientState>()
  readonly #subscriptions: Subscription[] = []
  #heartbeatTimer: ReturnType<typeof setInterval> | undefined

  constructor(deps: WsServerDeps) {
    this.#deps = deps
    this.#wss = new WSServer({ noServer: true })
    this.#wss.on('connection', (ws) => this.#onConnection(ws))
  }

  // ── Lifecycle ────────────────────────────────────────────────────────

  /** Attach to an HTTP server — handles `upgrade` requests on `/ws`. */
  attach(server: HttpServer): void {
    server.on('upgrade', (req, socket, head) => {
      if (!this.#isWsPath(req)) {
        socket.destroy()
        return
      }
      if (!this.#authenticate(req)) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n')
        socket.destroy()
        return
      }
      this.#wss.handleUpgrade(req, socket, head, (ws) => {
        this.#wss.emit('connection', ws, req)
      })
    })

    // Subscribe to global event streams (once)
    this.#subscriptions.push(
      this.#deps.events$.subscribe((event) => this.#broadcast('events', event)),
      this.#deps.uiEvents$.subscribe((event) => this.#broadcast('ui', event)),
    )

    // Server-side heartbeat: detect dead connections every 30s (B30)
    this.#heartbeatTimer = setInterval(() => {
      for (const [ws, state] of this.#clients) {
        if (!state.isAlive) {
          // No pong since last ping — terminate dead connection
          ws.terminate()
          this.#clients.delete(ws)
          continue
        }
        state.isAlive = false
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping()
        }
      }
    }, 30_000)
  }

  /** Gracefully shut down: close all connections, unsubscribe. */
  close(): void {
    if (this.#heartbeatTimer) {
      clearInterval(this.#heartbeatTimer)
      this.#heartbeatTimer = undefined
    }
    for (const sub of this.#subscriptions) sub.unsubscribe()
    this.#subscriptions.length = 0
    for (const [ws] of this.#clients) {
      ws.close(1001, 'Server shutting down')
    }
    this.#clients.clear()
    this.#wss.close()
  }

  /** Number of active connections (for testing/monitoring). */
  get connectionCount(): number {
    return this.#clients.size
  }

  // ── Connection Handling ──────────────────────────────────────────────

  #onConnection(ws: WebSocket): void {
    this.#clients.set(ws, { channels: new Set(), streamId: null, isAlive: true })

    // Track pong responses for liveness detection (B30)
    ws.on('pong', () => {
      const state = this.#clients.get(ws)
      if (state) state.isAlive = true
    })

    ws.on('message', (raw) => {
      try {
        const msg = parseClientMessage(String(raw))
        switch (msg.type) {
          case 'subscribe':
            this.#handleSubscribe(ws, msg).catch(() => {
              this.#send(ws, { type: 'error', code: 'SUBSCRIBE_FAILED', message: 'Subscribe failed' })
            })
            break
          case 'unsubscribe':
            this.#handleUnsubscribe(ws, msg)
            break
          case 'ping':
            this.#send(ws, { type: 'pong' })
            break
        }
      } catch {
        this.#send(ws, { type: 'error', code: 'INVALID_MESSAGE', message: 'Malformed message' })
      }
    })

    ws.on('close', () => {
      this.#clients.delete(ws)
    })

    ws.on('error', (err) => {
      console.error('[WsServer] client error:', err.message)
      this.#clients.delete(ws)
    })
  }

  async #handleSubscribe(
    ws: WebSocket,
    msg: { channels: Channel[]; streamId?: string | null; lastEventId?: number },
  ): Promise<void> {
    const state = this.#clients.get(ws)
    if (!state) return
    for (const ch of msg.channels) state.channels.add(ch)
    // Allow setting or clearing stream filter (B35)
    // Explicit null clears the filter; undefined (missing field) leaves it unchanged
    if ('streamId' in msg) {
      state.streamId = msg.streamId ?? null
    }

    this.#send(ws, { type: 'subscribed', channels: [...state.channels] })

    // Gap-fill: send missed events
    if (msg.lastEventId !== undefined && state.channels.has('events')) {
      try {
        const missed = await this.#deps.getEventsAfter(msg.lastEventId)
        for (const event of missed) {
          if (state.streamId && event.streamId !== state.streamId) continue
          this.#send(ws, { type: 'event', data: event })
        }
      } catch {
        this.#send(ws, { type: 'error', code: 'GAP_FILL_FAILED', message: 'Failed to replay events' })
      }
    }
  }

  #handleUnsubscribe(ws: WebSocket, msg: { channels: Channel[] }): void {
    const state = this.#clients.get(ws)
    if (!state) return
    for (const ch of msg.channels) state.channels.delete(ch)
  }

  // ── Broadcasting ─────────────────────────────────────────────────────

  #broadcast(channel: Channel, data: StoredEvent | UiEvent): void {
    const msgType = channel === 'events' ? 'event' : 'ui_event'
    for (const [ws, state] of this.#clients) {
      if (!state.channels.has(channel)) continue
      // Stream filtering for events channel
      if (channel === 'events' && state.streamId) {
        const event = data as StoredEvent
        if (event.streamId !== state.streamId) continue
      }
      this.#send(ws, { type: msgType, data } as ServerMessage)
    }
  }

  // ── Auth & Utils ────────────────────────────────────────────────────

  #isWsPath(req: IncomingMessage): boolean {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    return url.pathname === '/ws'
  }

  #authenticate(req: IncomingMessage): boolean {
    // Bypass auth for localhost connections (server only binds 127.0.0.1 by default)
    const remoteAddr = req.socket?.remoteAddress
    if (remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1') {
      return true
    }
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
    return url.searchParams.get('token') === this.#deps.authToken
  }

  #send(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(serializeServerMessage(msg))
    }
  }
}
