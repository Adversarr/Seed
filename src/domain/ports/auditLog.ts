/**
 * Domain Layer - Ports
 *
 * This module defines the AuditLog port interface.
 * AuditLog records all tool calls for traceability and debugging.
 * It is separate from DomainEvents - DomainEvents track collaboration/decisions,
 * AuditLog tracks execution details.
 */

import { z } from 'zod'
import type { Observable } from 'rxjs'

// ============================================================================
// Audit Log Entry Types
// ============================================================================

export const ToolCallRequestedPayloadSchema = z.object({
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  authorActorId: z.string().min(1),
  taskId: z.string().min(1),
  input: z.record(z.unknown()),
  timestamp: z.number()
})

export const ToolCallCompletedPayloadSchema = z.object({
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  authorActorId: z.string().min(1),
  taskId: z.string().min(1),
  output: z.unknown(),
  isError: z.boolean(),
  durationMs: z.number(),
  timestamp: z.number()
})

export type ToolCallRequestedPayload = z.infer<typeof ToolCallRequestedPayloadSchema>
export type ToolCallCompletedPayload = z.infer<typeof ToolCallCompletedPayloadSchema>

// ============================================================================
// Audit Log Entry Union
// ============================================================================

export type AuditLogEntry =
  | { type: 'ToolCallRequested'; payload: ToolCallRequestedPayload }
  | { type: 'ToolCallCompleted'; payload: ToolCallCompletedPayload }

// ============================================================================
// Stored Audit Entry (with persistence metadata)
// ============================================================================

export type StoredAuditEntry = AuditLogEntry & {
  id: number
  createdAt: string
}

// ============================================================================
// Audit Log Schema (for validation)
// ============================================================================

export const AuditLogEntrySchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ToolCallRequested'), payload: ToolCallRequestedPayloadSchema }),
  z.object({ type: z.literal('ToolCallCompleted'), payload: ToolCallCompletedPayloadSchema })
])

// ============================================================================
// Audit Log Interface
// ============================================================================

/**
 * AuditLog port interface.
 *
 * Records tool call requests and completions for traceability.
 * Stored separately from DomainEvents in audit.jsonl.
 */
export interface AuditLog {
  /**
   * Observable stream of new audit entries.
   * Emits each StoredAuditEntry as it is appended.
   */
  readonly entries$: Observable<StoredAuditEntry>

  /**
   * Initialize the storage (create file if needed).
   */
  ensureSchema(): void

  /**
   * Append an audit entry.
   *
   * @param entry - The audit entry to append
   * @returns The stored entry with assigned ID
   */
  append(entry: AuditLogEntry): StoredAuditEntry

  /**
   * Read all audit entries for a task.
   *
   * @param taskId - The task ID to filter by
   * @returns All audit entries for the task
   */
  readByTask(taskId: string): StoredAuditEntry[]

  /**
   * Read all audit entries.
   *
   * @param fromIdExclusive - Start reading after this ID (0 = from beginning)
   * @returns All entries after the specified ID
   */
  readAll(fromIdExclusive?: number): StoredAuditEntry[]
}
