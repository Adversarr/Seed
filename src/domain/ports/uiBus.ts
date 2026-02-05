import type { Observable } from 'rxjs'
import type { StoredAuditEntry } from './auditLog.js'

export type UiEvent =
  | {
      type: 'agent_output'
      payload: { taskId: string; kind: 'text' | 'reasoning'; content: string }
    }
  | {
      type: 'audit_entry'
      payload: StoredAuditEntry
    }

export interface UiBus {
  readonly events$: Observable<UiEvent>
  emit(event: UiEvent): void
}

