/**
 * Infrastructure Layer - JSONL Event Store (Async)
 *
 * Append-only event log stored as JSONL.
 *
 * Key design choices:
 * - All I/O uses `node:fs/promises` — never blocks the event loop.
 * - An in-process AsyncMutex replaces the old file-lock + Atomics.wait.
 * - A write-through in-memory cache eliminates redundant full-file reads.
 *   The cache is populated lazily on first access and updated atomically
 *   on every append/save, so read paths are pure in-memory filters.
 * - RxJS Subject is used internally for the events$ stream; the port
 *   contract is the framework-agnostic Subscribable<T>.
 */

import { appendFile, readFile, writeFile, mkdir, rename, unlink, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname } from 'node:path'
import { Subject } from 'rxjs'
import type { Subscribable } from '../../core/ports/subscribable.js'
import { parseDomainEvent, type DomainEvent, type StoredEvent } from '../../core/events/events.js'
import type { EventStore } from '../../core/ports/eventStore.js'
import { AsyncMutex } from '../asyncMutex.js'

// ============================================================================
// Internal Types
// ============================================================================

type JsonlEventRow = {
  id: number
  streamId: string
  seq: number
  type: string
  payload: unknown
  createdAt: string
}

type JsonlProjectionRow = {
  name: string
  cursorEventId: number
  stateJson: string
  updatedAt: string
}

// Type-safe helper to construct StoredEvent from DomainEvent
function toStoredEvent(
  meta: { id: number; streamId: string; seq: number; createdAt: string },
  evt: DomainEvent
): StoredEvent {
  return {
    ...meta,
    type: evt.type,
    payload: evt.payload
  } as StoredEvent
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

// ============================================================================
// Implementation
// ============================================================================

export class JsonlEventStore implements EventStore {
  readonly #eventsPath: string
  readonly #projectionsPath: string

  // RxJS internals — exposed as Subscribable at the port boundary
  readonly #eventSubject = new Subject<StoredEvent>()

  // Async mutex for write serialisation
  readonly #mutex = new AsyncMutex()

  // Write-through cache for events
  #eventsCache: JsonlEventRow[] = []
  #maxId = 0
  #streamSeqs = new Map<string, number>()
  #eventsCacheLoaded = false

  // Write-through cache for projections
  #projectionsCache = new Map<string, JsonlProjectionRow>()
  #projectionsCacheLoaded = false

  constructor(opts: { eventsPath: string; projectionsPath?: string }) {
    this.#eventsPath = opts.eventsPath
    this.#projectionsPath =
      opts.projectionsPath ?? opts.eventsPath.replace(/events\.jsonl$/, 'projections.jsonl')
  }

  // ======================== Subscribable ========================

  get events$(): Subscribable<StoredEvent> {
    return this.#eventSubject.asObservable()
  }

  // ======================== Schema ========================

  async ensureSchema(): Promise<void> {
    await mkdir(dirname(this.#eventsPath), { recursive: true })
    await mkdir(dirname(this.#projectionsPath), { recursive: true })
    if (!(await fileExists(this.#eventsPath))) await writeFile(this.#eventsPath, '')
    if (!(await fileExists(this.#projectionsPath))) await writeFile(this.#projectionsPath, '')
  }

  // ======================== Events ========================

  async append(streamId: string, events: DomainEvent[]): Promise<StoredEvent[]> {
    await this.#ensureEventsCacheLoaded()

    const stored = await this.#mutex.runExclusive(async () => {
      const now = new Date().toISOString()
      let currentMaxId = this.#maxId
      let currentSeq = this.#streamSeqs.get(streamId) ?? 0

      const newRows: JsonlEventRow[] = []
      const result: StoredEvent[] = []

      for (const evt of events) {
        currentMaxId += 1
        currentSeq += 1
        const row: JsonlEventRow = {
          id: currentMaxId,
          streamId,
          seq: currentSeq,
          type: evt.type,
          payload: evt.payload,
          createdAt: now
        }
        newRows.push(row)
        result.push(toStoredEvent({ id: row.id, streamId, seq: row.seq, createdAt: now }, evt))
      }

      // Disk write (ENOENT tolerated — dir may be gone in test teardown)
      const lines = newRows.map((r) => JSON.stringify(r)).join('\n') + '\n'
      try {
        await appendFile(this.#eventsPath, lines)
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }

      // Cache update
      this.#eventsCache.push(...newRows)
      this.#maxId = currentMaxId
      this.#streamSeqs.set(streamId, currentSeq)

      return result
    })

    // Emit outside the mutex so subscribers don't block writes
    for (const e of stored) this.#eventSubject.next(e)
    return stored
  }

  async readAll(fromIdExclusive = 0): Promise<StoredEvent[]> {
    await this.#ensureEventsCacheLoaded()
    return this.#eventsCache
      .filter((r) => r.id > fromIdExclusive)
      .map((r) => this.#rowToStoredEvent(r))
  }

  async readStream(streamId: string, fromSeqInclusive = 1): Promise<StoredEvent[]> {
    await this.#ensureEventsCacheLoaded()
    return this.#eventsCache
      .filter((r) => r.streamId === streamId && r.seq >= fromSeqInclusive)
      .map((r) => this.#rowToStoredEvent(r))
  }

  async readById(id: number): Promise<StoredEvent | null> {
    await this.#ensureEventsCacheLoaded()
    const row = this.#eventsCache.find((r) => r.id === id)
    if (!row) return null
    return this.#rowToStoredEvent(row)
  }

  // ======================== Projections ========================

  async getProjection<TState>(
    name: string,
    defaultState: TState
  ): Promise<{ cursorEventId: number; state: TState }> {
    await this.#ensureProjectionsCacheLoaded()
    const row = this.#projectionsCache.get(name)
    if (!row) return { cursorEventId: 0, state: defaultState }
    return { cursorEventId: row.cursorEventId, state: JSON.parse(row.stateJson) as TState }
  }

  async saveProjection<TState>(name: string, cursorEventId: number, state: TState): Promise<void> {
    await this.#ensureProjectionsCacheLoaded()

    await this.#mutex.runExclusive(async () => {
      const row: JsonlProjectionRow = {
        name,
        cursorEventId,
        stateJson: JSON.stringify(state),
        updatedAt: new Date().toISOString()
      }

      // Prepare content with updated cache (temporarily)
      const tempCache = new Map(this.#projectionsCache)
      tempCache.set(name, row)
      const content =
        [...tempCache.values()].map((r) => JSON.stringify(r)).join('\n') + '\n'
      const tmpPath = `${this.#projectionsPath}.${process.pid}.${Date.now()}.tmp`
      try {
        await writeFile(tmpPath, content)
        await rename(tmpPath, this.#projectionsPath)
        // Only update cache AFTER successful write (B10)
        this.#projectionsCache.set(name, row)
      } catch (err: unknown) {
        // ENOENT can happen if the directory was removed (e.g. test teardown)
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      } finally {
        try {
          await unlink(tmpPath)
        } catch {
          /* best-effort cleanup — file may already be renamed or dir gone */
        }
      }
    })
  }

  // ======================== Cache Loading ========================

  async #ensureEventsCacheLoaded(): Promise<void> {
    if (this.#eventsCacheLoaded) return
    this.#eventsCache = await this.#readEventsFromDisk()
    for (const e of this.#eventsCache) {
      this.#maxId = Math.max(this.#maxId, e.id)
      const curr = this.#streamSeqs.get(e.streamId) ?? 0
      this.#streamSeqs.set(e.streamId, Math.max(curr, e.seq))
    }
    this.#eventsCacheLoaded = true
  }

  async #ensureProjectionsCacheLoaded(): Promise<void> {
    if (this.#projectionsCacheLoaded) return
    this.#projectionsCache = await this.#readAllProjectionsFromDisk()
    this.#projectionsCacheLoaded = true
  }

  // ======================== Disk I/O ========================

  async #readEventsFromDisk(): Promise<JsonlEventRow[]> {
    if (!(await fileExists(this.#eventsPath))) return []
    const raw = await readFile(this.#eventsPath, 'utf8')
    if (!raw.trim()) return []
    const rows: JsonlEventRow[] = []
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        rows.push(JSON.parse(trimmed) as JsonlEventRow)
      } catch (err) {
        console.error(`[JsonlEventStore] Corrupted event line in ${this.#eventsPath}: ${trimmed.slice(0, 120)}`, err)
        continue
      }
    }
    return rows
  }

  async #readAllProjectionsFromDisk(): Promise<Map<string, JsonlProjectionRow>> {
    const result = new Map<string, JsonlProjectionRow>()
    if (!(await fileExists(this.#projectionsPath))) return result
    const raw = await readFile(this.#projectionsPath, 'utf8')
    if (!raw.trim()) return result
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const row = JSON.parse(trimmed) as JsonlProjectionRow
        result.set(row.name, row)
      } catch (err) {
        console.error(`[JsonlEventStore] Corrupted projection line in ${this.#projectionsPath}: ${trimmed.slice(0, 120)}`, err)
        continue
      }
    }
    return result
  }

  // ======================== Helpers ========================

  #rowToStoredEvent(row: JsonlEventRow): StoredEvent {
    const parsed = parseDomainEvent({ type: row.type, payload: row.payload })
    return toStoredEvent(
      { id: row.id, streamId: row.streamId, seq: row.seq, createdAt: row.createdAt },
      parsed
    )
  }
}
