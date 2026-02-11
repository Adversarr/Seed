import { describe, it, expect, vi } from 'vitest'
import { DefaultToolExecutor } from '../src/infrastructure/tools/toolExecutor.js'
import type { ToolRegistry, Tool, ToolContext } from '../src/core/ports/tool.js'
import type { AuditLog } from '../src/core/ports/auditLog.js'
import { Subject } from 'rxjs'

describe('DefaultToolExecutor', () => {
  const mockTool: Tool = {
    name: 'safeTool',
    description: 'Safe tool',
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query' } }, required: ['query'] },
    group: 'search',
    riskLevel: 'safe',
    execute: async () => ({ toolCallId: '1', output: { ok: true }, isError: false })
  }

  const mockRiskyTool: Tool = {
    name: 'riskyTool',
    description: 'Risky tool',
    parameters: { type: 'object', properties: {} },
    group: 'search',
    riskLevel: 'risky',
    execute: async () => ({ toolCallId: '2', output: { ok: true }, isError: false })
  }

  const mockRegistry: ToolRegistry = {
    register: vi.fn(),
    get: vi.fn((name) => {
      if (name === 'safeTool') return mockTool
      if (name === 'riskyTool') return mockRiskyTool
      return undefined
    }),
    list: vi.fn(),
    listByGroups: vi.fn(),
    toOpenAIFormat: vi.fn(),
    toOpenAIFormatByGroups: vi.fn()
  }

  const entries$ = new Subject()
  const mockAuditLog: AuditLog = {
    entries$,
    ensureSchema: vi.fn(),
    append: vi.fn().mockResolvedValue({ id: 1, createdAt: new Date().toISOString() }),
    readByTask: vi.fn(),
    readAll: vi.fn()
  }

  const executor = new DefaultToolExecutor({ registry: mockRegistry, auditLog: mockAuditLog })
  const context: ToolContext = {
    taskId: 't1',
    actorId: 'u1',
    baseDir: '/tmp'
  } as ToolContext

  it('should execute safe tool and log audit', async () => {
    vi.mocked(mockAuditLog.append).mockClear()
    const result = await executor.execute({
      toolCallId: '1',
      toolName: 'safeTool',
      arguments: { query: 'test' }
    }, context)

    expect(result.isError).toBe(false)
    expect(mockAuditLog.append).toHaveBeenCalledTimes(2) // Request + Complete
    expect(mockAuditLog.append).toHaveBeenCalledWith(expect.objectContaining({ type: 'ToolCallRequested' }))
    expect(mockAuditLog.append).toHaveBeenCalledWith(expect.objectContaining({ type: 'ToolCallCompleted' }))
  })

  it('should block risky tool without confirmation', async () => {
    vi.mocked(mockAuditLog.append).mockClear()
    const result = await executor.execute({
      toolCallId: '2',
      toolName: 'riskyTool',
      arguments: {}
    }, context)

    expect(result.isError).toBe(true)
    expect((result.output as any).error).toContain('requires user confirmation')
    // Risk-blocked calls still get audited (Request + Complete with error)
    expect(mockAuditLog.append).toHaveBeenCalledTimes(2)
  })

  it('should execute risky tool with confirmation', async () => {
    vi.mocked(mockAuditLog.append).mockClear()
    const result = await executor.execute({
      toolCallId: '3',
      toolName: 'riskyTool',
      arguments: {}
    }, { ...context, confirmedInteractionId: 'ui_1' })

    expect(result.isError).toBe(false)
    expect(mockAuditLog.append).toHaveBeenCalledTimes(2) // Request + Complete
  })

  it('should record rejection with audit entries', () => {
    vi.mocked(mockAuditLog.append).mockClear()

    const result = executor.recordRejection({
      toolCallId: '4',
      toolName: 'riskyTool',
      arguments: { path: 'hello.txt' }
    }, context)

    expect(result.isError).toBe(true)
    expect(result.toolCallId).toBe('4')
    expect((result.output as any).error).toBe('User rejected the request')

    // Should emit both ToolCallRequested and ToolCallCompleted
    expect(mockAuditLog.append).toHaveBeenCalledTimes(2)
    expect(mockAuditLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ToolCallRequested',
        payload: expect.objectContaining({
          toolCallId: '4',
          toolName: 'riskyTool',
          input: { path: 'hello.txt' }
        })
      })
    )
    expect(mockAuditLog.append).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ToolCallCompleted',
        payload: expect.objectContaining({
          toolCallId: '4',
          toolName: 'riskyTool',
          isError: true,
          durationMs: 0
        })
      })
    )
  })

  // ── New tests for bug fixes ──

  it('should reject execution when actorId is empty (B13)', async () => {
    vi.mocked(mockAuditLog.append).mockClear()
    const result = await executor.execute({
      toolCallId: '5',
      toolName: 'safeTool',
      arguments: { query: 'test' }
    }, { ...context, actorId: '' })

    expect(result.isError).toBe(true)
    expect((result.output as any).error).toContain('actorId is required')
    // Should NOT have called audit log since actorId is missing
    expect(mockAuditLog.append).not.toHaveBeenCalled()
  })

  it('should reject tool with invalid arguments against schema (B5)', async () => {
    vi.mocked(mockAuditLog.append).mockClear()
    // safeTool requires 'query' (string) — pass a number instead
    const result = await executor.execute({
      toolCallId: '6',
      toolName: 'safeTool',
      arguments: { query: 123 }
    }, context)

    expect(result.isError).toBe(true)
    expect((result.output as any).error).toContain('Invalid tool arguments')
    // Should still have audit entries (Request + Complete with error)
    expect(mockAuditLog.append).toHaveBeenCalledTimes(2)
  })

  it('should reject tool with missing required arguments (B5)', async () => {
    vi.mocked(mockAuditLog.append).mockClear()
    // safeTool requires 'query' — omit it
    const result = await executor.execute({
      toolCallId: '7',
      toolName: 'safeTool',
      arguments: {}
    }, context)

    expect(result.isError).toBe(true)
    expect((result.output as any).error).toContain('Missing required argument')
  })

  it('should await audit log calls without unhandled rejections (NEW-B1)', async () => {
    vi.mocked(mockAuditLog.append).mockClear()
    // Make append throw — should be caught, not cause unhandled rejection
    vi.mocked(mockAuditLog.append).mockRejectedValueOnce(new Error('disk full'))
    vi.mocked(mockAuditLog.append).mockResolvedValueOnce({ id: 2, createdAt: new Date().toISOString() } as any)

    const result = await executor.execute({
      toolCallId: '8',
      toolName: 'safeTool',
      arguments: { query: 'test' }
    }, context)

    // Tool execution should still succeed even if first audit write failed
    expect(result.isError).toBe(false)
    expect(mockAuditLog.append).toHaveBeenCalledTimes(2)
  })
})
