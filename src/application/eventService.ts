/**
 * Application Layer - Event Service
 *
 * Encapsulates event replay and query use cases.
 */

import type { EventStore, StoredEvent } from '../domain/index.js'

export class EventService {
  readonly #store: EventStore

  constructor(store: EventStore) {
    this.#store = store
  }

  /**
   * Replay all events or events for a specific stream.
   */
  async replayEvents(streamId?: string): Promise<StoredEvent[]> {
    if (!streamId) {
      return this.#store.readAll(0)
    }
    return this.#store.readStream(streamId, 1)
  }

  /**
   * Get a single event by ID.
   */
  async getEventById(id: number): Promise<StoredEvent | null> {
    return this.#store.readById(id)
  }

  /**
   * Get events after a specific ID.
   */
  async getEventsAfter(fromIdExclusive: number): Promise<StoredEvent[]> {
    return this.#store.readAll(fromIdExclusive)
  }
}
