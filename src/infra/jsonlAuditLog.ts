/**
 * Infrastructure Layer - JSONL Audit Log Implementation
 *
 * Stores tool call audit entries in a separate JSONL file.
 * This is separate from DomainEvents to keep the event stream clean.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from 'node:fs'
import { dirname } from 'node:path'
import type { AuditLog, AuditLogEntry, StoredAuditEntry } from '../domain/ports/auditLog.js'
import { AuditLogEntrySchema } from '../domain/ports/auditLog.js'

// JSONL row format for audit entries
type JsonlAuditRow = {
  id: number
  type: string
  payload: unknown
  createdAt: string
}

export class JsonlAuditLog implements AuditLog {
  readonly #auditPath: string
  #maxId = 0
  #cacheInitialized = false

  constructor(opts: { auditPath: string }) {
    this.#auditPath = opts.auditPath
  }

  ensureSchema(): void {
    mkdirSync(dirname(this.#auditPath), { recursive: true })
    if (!existsSync(this.#auditPath)) {
      writeFileSync(this.#auditPath, '')
    }
  }

  append(entry: AuditLogEntry): StoredAuditEntry {
    this.#ensureCacheInitialized()
    
    const now = new Date().toISOString()
    this.#maxId += 1

    const row: JsonlAuditRow = {
      id: this.#maxId,
      type: entry.type,
      payload: entry.payload,
      createdAt: now
    }

    appendFileSync(this.#auditPath, `${JSON.stringify(row)}\n`)

    return {
      ...entry,
      id: row.id,
      createdAt: row.createdAt
    }
  }

  readByTask(taskId: string): StoredAuditEntry[] {
    const all = this.readAll()
    return all.filter((entry) => entry.payload.taskId === taskId)
  }

  readAll(fromIdExclusive = 0): StoredAuditEntry[] {
    const rows = this.#readEntries()
    return rows
      .filter((r) => r.id > fromIdExclusive)
      .map((r) => this.#rowToStoredEntry(r))
  }

  #ensureCacheInitialized(): void {
    if (this.#cacheInitialized) return
    this.#rebuildCacheFromDisk()
  }

  #rebuildCacheFromDisk(): void {
    const rows = this.#readEntries()
    this.#maxId = rows.length > 0 ? Math.max(...rows.map((r) => r.id)) : 0
    this.#cacheInitialized = true
  }

  #readEntries(): JsonlAuditRow[] {
    if (!existsSync(this.#auditPath)) return []
    const raw = readFileSync(this.#auditPath, 'utf8')
    const lines = raw.split('\n').filter((line) => line.trim())
    return lines.map((line) => JSON.parse(line) as JsonlAuditRow)
  }

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

export function createAuditLog(auditPath: string): AuditLog {
  const log = new JsonlAuditLog({ auditPath })
  log.ensureSchema()
  return log
}
