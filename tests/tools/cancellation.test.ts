/**
 * Tests for tool cancellation standardization:
 * - PR-001: runCommand AbortSignal support (kills child process)
 * - PR-003: DefaultToolExecutor early abort check
 */

import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import { DefaultToolExecutor } from '../../src/infra/toolExecutor.js'
import { DefaultToolRegistry } from '../../src/infra/toolRegistry.js'
import type { Tool, ToolContext, ToolResult } from '../../src/domain/ports/tool.js'
import type { AuditLog } from '../../src/domain/ports/auditLog.js'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function mockAuditLog(): AuditLog {
  return {
    append: vi.fn(),
    readByTask: vi.fn().mockResolvedValue([]),
    readAll: vi.fn().mockResolvedValue([])
  }
}

function createExecutor() {
  const registry = new DefaultToolRegistry()
  const auditLog = mockAuditLog()
  const executor = new DefaultToolExecutor({ registry, auditLog })
  return { registry, auditLog, executor }
}

// ---------------------------------------------------------------------------
// PR-003 — Early abort check in DefaultToolExecutor
// ---------------------------------------------------------------------------

describe('PR-003: DefaultToolExecutor early abort', () => {
  test('returns error result when signal is already aborted', async () => {
    const { registry, executor } = createExecutor()

    const mockTool: Tool = {
      name: 'never_called',
      description: 'Should not execute',
      parameters: { type: 'object', properties: {} },
      riskLevel: 'safe',
      execute: vi.fn(async () => ({ toolCallId: 'x', isError: false, output: 'ok' }))
    }
    registry.register(mockTool)

    const controller = new AbortController()
    controller.abort()

    const ctx: ToolContext = {
      taskId: 't1',
      actorId: 'a1',
      baseDir: '/tmp',
      signal: controller.signal
    }

    const result = await executor.execute(
      { toolCallId: 'call_1', toolName: 'never_called', arguments: {} },
      ctx
    )

    expect(result.isError).toBe(true)
    expect((result.output as any).error).toContain('aborted')
    // The tool's execute should NEVER be called
    expect(mockTool.execute).not.toHaveBeenCalled()
  })

  test('executes normally when signal is not aborted', async () => {
    const { registry, executor } = createExecutor()

    const mockTool: Tool = {
      name: 'safe_tool',
      description: 'Runs fine',
      parameters: { type: 'object', properties: {} },
      riskLevel: 'safe',
      execute: vi.fn(async () => ({ toolCallId: 'x', isError: false, output: 'ok' }))
    }
    registry.register(mockTool)

    const controller = new AbortController()
    // NOT aborted

    const ctx: ToolContext = {
      taskId: 't1',
      actorId: 'a1',
      baseDir: '/tmp',
      signal: controller.signal
    }

    const result = await executor.execute(
      { toolCallId: 'call_2', toolName: 'safe_tool', arguments: {} },
      ctx
    )

    expect(result.isError).toBe(false)
    expect(mockTool.execute).toHaveBeenCalledTimes(1)
  })

  test('executes normally when no signal provided', async () => {
    const { registry, executor } = createExecutor()

    const mockTool: Tool = {
      name: 'basic_tool',
      description: 'Basic',
      parameters: { type: 'object', properties: {} },
      riskLevel: 'safe',
      execute: vi.fn(async () => ({ toolCallId: 'x', isError: false, output: 'ok' }))
    }
    registry.register(mockTool)

    const ctx: ToolContext = {
      taskId: 't1',
      actorId: 'a1',
      baseDir: '/tmp'
      // No signal
    }

    const result = await executor.execute(
      { toolCallId: 'call_3', toolName: 'basic_tool', arguments: {} },
      ctx
    )

    expect(result.isError).toBe(false)
    expect(mockTool.execute).toHaveBeenCalledTimes(1)
  })

  test('audit log records aborted tool calls', async () => {
    const { registry, executor, auditLog } = createExecutor()

    registry.register({
      name: 'audited_tool',
      description: 'Audited',
      parameters: { type: 'object', properties: {} },
      riskLevel: 'safe',
      execute: vi.fn(async () => ({ toolCallId: 'x', isError: false, output: 'ok' }))
    })

    const controller = new AbortController()
    controller.abort()

    await executor.execute(
      { toolCallId: 'call_audit', toolName: 'audited_tool', arguments: {} },
      { taskId: 't1', actorId: 'a1', baseDir: '/tmp', signal: controller.signal }
    )

    // Should still log ToolCallRequested and ToolCallCompleted (with abort error)
    expect(auditLog.append).toHaveBeenCalledTimes(2)
    const completedCall = (auditLog.append as any).mock.calls[1][0]
    expect(completedCall.type).toBe('ToolCallCompleted')
    expect(completedCall.payload.isError).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// PR-001 — runCommand AbortSignal support
// ---------------------------------------------------------------------------

describe('PR-001: runCommand abort support', () => {
  test('runCommand returns error when signal is pre-aborted', async () => {
    // Import dynamically to use the real mock
    const { runCommandTool } = await import('../../src/infra/tools/runCommand.js')

    const controller = new AbortController()
    controller.abort()

    const result = await runCommandTool.execute(
      { command: 'echo test' },
      { baseDir: '/tmp', taskId: 't1', actorId: 'a1', signal: controller.signal }
    )

    expect(result.isError).toBe(true)
    expect((result.output as any).error).toContain('aborted')
  })
})
