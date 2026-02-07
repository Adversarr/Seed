/**
 * Application Layer - Audit Service
 *
 * Provides access to audit logs for CLI and TUI.
 */

import { concat, filter, from, Observable } from 'rxjs'
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
  async getRecentEntries(taskId?: string, limit: number = 20): Promise<StoredAuditEntry[]> {
    let entries: StoredAuditEntry[]
    
    if (taskId) {
      entries = await this.#auditLog.readByTask(taskId)
    } else {
      entries = await this.#auditLog.readAll()
    }

    // Sort by ID descending (newest first) since IDs are monotonic
    entries.sort((a, b) => b.id - a.id)
    
    return entries.slice(0, limit)
  }

  async observeEntries(taskId?: string): Promise<Observable<StoredAuditEntry>> {
    const historyEntries = taskId
      ? await this.#auditLog.readByTask(taskId)
      : await this.#auditLog.readAll()
    historyEntries.sort((a, b) => a.id - b.id)

    // Lift Subscribable to Observable for RxJS composition
    const live$ = new Observable<StoredAuditEntry>((subscriber) => {
      const sub = this.#auditLog.entries$.subscribe((v) => subscriber.next(v))
      return () => sub.unsubscribe()
    })

    const filtered$ = taskId
      ? live$.pipe(filter((entry) => entry.payload.taskId === taskId))
      : live$

    return concat(from(historyEntries), filtered$)
  }
}
