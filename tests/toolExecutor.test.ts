import { describe, it, expect, vi } from 'vitest'
import { DefaultToolExecutor } from '../src/infra/toolExecutor.js'
import type { ToolRegistry, Tool, ToolContext } from '../src/domain/ports/tool.js'
import type { AuditLog } from '../src/domain/ports/auditLog.js'

describe('DefaultToolExecutor', () => {
  const mockTool: Tool = {
    name: 'safeTool',
    description: 'Safe tool',
    parameters: { type: 'object', properties: {} },
    riskLevel: 'safe',
    execute: async () => ({ toolCallId: '1', output: { ok: true }, isError: false })
  }

  const mockRiskyTool: Tool = {
    name: 'riskyTool',
    description: 'Risky tool',
    parameters: { type: 'object', properties: {} },
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
    toOpenAIFormat: vi.fn()
  }

  const mockAuditLog: AuditLog = {
    ensureSchema: vi.fn(),
    append: vi.fn(),
    readByTask: vi.fn(),
    readAll: vi.fn()
  }

  const executor = new DefaultToolExecutor({ registry: mockRegistry, auditLog: mockAuditLog })
  const context: ToolContext = {
    taskId: 't1',
    actorId: 'u1',
    baseDir: '/tmp'
  }

  it('should execute safe tool and log audit', async () => {
    const result = await executor.execute({
      toolCallId: '1',
      toolName: 'safeTool',
      arguments: {}
    }, context)

    expect(result.isError).toBe(false)
    expect(mockAuditLog.append).toHaveBeenCalledTimes(2) // Request + Complete
    expect(mockAuditLog.append).toHaveBeenCalledWith(expect.objectContaining({ type: 'ToolCallRequested' }))
    expect(mockAuditLog.append).toHaveBeenCalledWith(expect.objectContaining({ type: 'ToolCallCompleted' }))
  })

  it('should block risky tool without confirmation', async () => {
    const result = await executor.execute({
      toolCallId: '2',
      toolName: 'riskyTool',
      arguments: {}
    }, context)

    expect(result.isError).toBe(true)
    expect((result.output as any).error).toContain('requires user confirmation')
    expect(mockAuditLog.append).toHaveBeenCalledTimes(2) // Previous 2 calls only
  })

  it('should execute risky tool with confirmation', async () => {
    const result = await executor.execute({
      toolCallId: '3',
      toolName: 'riskyTool',
      arguments: {}
    }, { ...context, confirmedInteractionId: 'ui_1' })

    expect(result.isError).toBe(false)
    expect(mockAuditLog.append).toHaveBeenCalledTimes(4) // 2 previous + 2 new
  })
})
