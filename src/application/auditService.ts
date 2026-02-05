/**
 * Application Layer - Audit Service
 *
 * Provides access to audit logs for CLI and TUI.
 */

import { concat, filter, from, type Observable } from 'rxjs'
import type { AuditLog, StoredAuditEntry } from '../domain/ports/auditLog.js'

export class AuditService {
  readonly #auditLog: AuditLog

  constructor(auditLog: AuditLog) {
    this.#auditLog = auditLog
  }

  /**
   * Get recent audit entries, optionally filtered by task ID.
   * Returns entries sorted by timestamp descending (newest first).
   */
  getRecentEntries(taskId?: string, limit: number = 20): StoredAuditEntry[] {
    let entries: StoredAuditEntry[]
    
    if (taskId) {
      entries = this.#auditLog.readByTask(taskId)
    } else {
      entries = this.#auditLog.readAll()
    }

    // Sort by ID descending (newest first) since IDs are monotonic
    entries.sort((a, b) => b.id - a.id)
    
    return entries.slice(0, limit)
  }

  observeEntries(taskId?: string): Observable<StoredAuditEntry> {
    const historyEntries = taskId ? this.#auditLog.readByTask(taskId) : this.#auditLog.readAll()
    historyEntries.sort((a, b) => a.id - b.id)

    const liveEntries = this.#auditLog.entries$

    const filteredLiveEntries = taskId
      ? liveEntries.pipe(filter((entry) => entry.payload.taskId === taskId))
      : liveEntries

    return concat(from(historyEntries), filteredLiveEntries)
  }
}
