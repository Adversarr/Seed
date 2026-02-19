/**
 * Infrastructure Layer - JSONL Audit Log (Async)
 *
 * Stores tool-call audit entries in an append-only JSONL file.
 * Separated from DomainEvents to keep the event stream clean.
 *
 * Design: async I/O, write-through cache, RxJS Subject internally,
 * Subscribable<T> at the port boundary.
 */

import { appendFile, readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { dirname } from 'node:path'
import { Subject } from 'rxjs'
import type { Subscribable } from '../../core/ports/subscribable.js'
import type { AuditLog, AuditLogEntry, StoredAuditEntry } from '../../core/ports/auditLog.js'
import { AuditLogEntrySchema } from '../../core/ports/auditLog.js'
import { AsyncMutex } from '../../shared/asyncMutex.js'

// ============================================================================
// Internal Types
// ============================================================================

type JsonlAuditRow = {
  id: number
  type: string
  payload: unknown
  createdAt: string
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

export class JsonlAuditLog implements AuditLog {
  readonly #auditPath: string
  readonly #entrySubject = new Subject<StoredAuditEntry>()
  readonly #mutex = new AsyncMutex()

  // Write-through cache
  #entriesCache: JsonlAuditRow[] = []
  #maxId = 0
  #cacheLoaded = false

  constructor(opts: { auditPath: string }) {
    this.#auditPath = opts.auditPath
  }

  // ======================== Subscribable ========================

  get entries$(): Subscribable<StoredAuditEntry> {
    return this.#entrySubject.asObservable()
  }

  // ======================== Schema ========================

  async ensureSchema(): Promise<void> {
    await mkdir(dirname(this.#auditPath), { recursive: true })
    if (!(await fileExists(this.#auditPath))) {
      await writeFile(this.#auditPath, '')
    }
  }

  // ======================== Append ========================

  async append(entry: AuditLogEntry): Promise<StoredAuditEntry> {
    // Validate entry structure before persisting (NEW-B4)
    const parsed = AuditLogEntrySchema.parse(entry)

    await this.#ensureCacheLoaded()

    const stored = await this.#mutex.runExclusive(async () => {
      const now = new Date().toISOString()
      this.#maxId += 1
      const newId = this.#maxId

      const row: JsonlAuditRow = {
        id: newId,
        type: parsed.type,
        payload: parsed.payload,
        createdAt: now
      }

      // Write to disk FIRST — only cache on success (B11)
      try {
        await appendFile(this.#auditPath, `${JSON.stringify(row)}\n`)
      } catch (err: unknown) {
        // Roll back the ID increment on failure
        this.#maxId = newId - 1
        throw err
      }
      this.#entriesCache.push(row)

      const storedEntry: StoredAuditEntry = {
        ...parsed,
        id: row.id,
        createdAt: row.createdAt
      }
      return storedEntry
    })

    this.#entrySubject.next(stored)
    return stored
  }

  // ======================== Reads ========================

  async readByTask(taskId: string): Promise<StoredAuditEntry[]> {
    const all = await this.readAll()
    return all.filter((entry) => entry.payload.taskId === taskId)
  }

  async readAll(fromIdExclusive = 0): Promise<StoredAuditEntry[]> {
    await this.#ensureCacheLoaded()
    return this.#entriesCache
      .filter((r) => r.id > fromIdExclusive)
      .map((r) => this.#rowToStoredEntry(r))
  }

  // ======================== Cache ========================

  async #ensureCacheLoaded(): Promise<void> {
    if (this.#cacheLoaded) return
    this.#entriesCache = await this.#readEntriesFromDisk()
    this.#maxId =
      this.#entriesCache.length > 0
        ? Math.max(...this.#entriesCache.map((r) => r.id))
        : 0
    this.#cacheLoaded = true
  }

  // ======================== Disk I/O ========================

  async #readEntriesFromDisk(): Promise<JsonlAuditRow[]> {
    if (!(await fileExists(this.#auditPath))) return []
    const raw = await readFile(this.#auditPath, 'utf8')
    const rows: JsonlAuditRow[] = []
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        rows.push(JSON.parse(trimmed) as JsonlAuditRow)
      } catch (err) {
        console.error(`[JsonlAuditLog] Corrupted audit line in ${this.#auditPath}: ${trimmed.slice(0, 120)}`, err)
        continue
      }
    }
    return rows
  }

  // ======================== Helpers ========================

  #rowToStoredEntry(row: JsonlAuditRow): StoredAuditEntry {
    const parsed = AuditLogEntrySchema.parse({ type: row.type, payload: row.payload })
    return {
      ...parsed,
      id: row.id,
      createdAt: row.createdAt
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export async function createAuditLog(auditPath: string): Promise<AuditLog> {
  const log = new JsonlAuditLog({ auditPath })
  await log.ensureSchema()
  return log
}
