import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { nanoid } from 'nanoid'
import { createAuditLog } from '../src/infra/jsonlAuditLog.js'
import { AuditService } from '../src/application/auditService.js'
import type { AuditLogEntry } from '../src/domain/ports/auditLog.js'

describe('Audit System', () => {
  let baseDir: string
  let auditPath: string

  beforeEach(() => {
    baseDir = join(tmpdir(), `coauthor-audit-${nanoid()}`)
    mkdirSync(baseDir, { recursive: true })
    auditPath = join(baseDir, 'audit.jsonl')
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('should append and read audit entries', () => {
    const log = createAuditLog(auditPath)
    const service = new AuditService(log)

    const entry1: AuditLogEntry = {
      type: 'ToolCallRequested',
      payload: {
        toolCallId: '1',
        toolName: 'test',
        authorActorId: 'user',
        taskId: 't1',
        input: { foo: 'bar' },
        timestamp: Date.now()
      }
    }

    const entry2: AuditLogEntry = {
      type: 'ToolCallCompleted',
      payload: {
        toolCallId: '1',
        toolName: 'test',
        authorActorId: 'user',
        taskId: 't1',
        output: { result: 'ok' },
        isError: false,
        durationMs: 10,
        timestamp: Date.now() + 10
      }
    }

    log.append(entry1)
    log.append(entry2)

    // Test readAll
    const all = log.readAll()
    expect(all).toHaveLength(2)
    expect(all[0].id).toBe(1)
    expect(all[1].id).toBe(2)

    // Test readByTask
    const taskEntries = log.readByTask('t1')
    expect(taskEntries).toHaveLength(2)
    const emptyEntries = log.readByTask('t2')
    expect(emptyEntries).toHaveLength(0)

    // Test AuditService
    const recent = service.getRecentEntries('t1')
    expect(recent).toHaveLength(2)
    expect(recent[0].id).toBe(2) // Sorted descending
    expect(recent[1].id).toBe(1)
  })
})
