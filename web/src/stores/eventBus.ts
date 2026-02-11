/**
 * EventBus — lightweight typed pub/sub for decoupling WebSocket events from stores.
 *
 * The connectionStore publishes raw events here; individual stores subscribe
 * independently. This eliminates direct store-to-store imports and makes each
 * store independently testable.
 */

import type { StoredEvent, UiEvent } from '@/types'

type EventMap = {
  'domain-event': StoredEvent
  'ui-event': UiEvent
}

type Handler<T> = (data: T) => void

class EventBus {
  readonly #handlers = new Map<string, Set<Handler<never>>>()

  on<K extends keyof EventMap>(event: K, handler: Handler<EventMap[K]>): () => void {
    if (!this.#handlers.has(event)) this.#handlers.set(event, new Set())
    const set = this.#handlers.get(event)!
    set.add(handler as Handler<never>)
    return () => { set.delete(handler as Handler<never>) }
  }

  emit<K extends keyof EventMap>(event: K, data: EventMap[K]): void {
    const set = this.#handlers.get(event)
    if (!set) return
    for (const handler of set) {
      try {
        ;(handler as Handler<EventMap[K]>)(data)
      } catch (err) {
        console.error(`[EventBus] handler error on "${event}":`, err)
      }
    }
  }

  /** Remove all handlers (useful for tests). */
  clear(): void {
    this.#handlers.clear()
  }
}

/** Singleton event bus — shared across all stores. */
export const eventBus = new EventBus()
