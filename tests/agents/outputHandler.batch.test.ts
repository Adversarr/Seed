import { describe, it, expect, vi, beforeEach, Mock } from 'vitest'
import { OutputHandler } from '../../src/agents/orchestration/outputHandler.js'
import type { Tool, ToolRegistry, ToolExecutor, ToolResult } from '../../src/core/ports/tool.js'
import type { UiBus, UiEvent } from '../../src/core/ports/uiBus.js'

function createMockTool(name: string, riskLevel: 'safe' | 'risky', executeFn?: () => unknown): Tool {
  return {
    name,
    description: `${riskLevel} tool`,
    parameters: { type: 'object', properties: {} },
    group: 'test',
    riskLevel,
    execute: vi.fn().mockImplementation(executeFn || (() => Promise.resolve({ result: `${name}-output` }))),
  }
}

function createMockRegistry(tools: Map<string, Tool>): ToolRegistry {
  return {
    get: vi.fn((name: string) => tools.get(name)),
    register: vi.fn(),
    list: vi.fn(() => [...tools.values()]),
    toOpenAIFormat: vi.fn(),
  }
}

function createMockExecutor(): ToolExecutor & { executeCalls: Array<{ call: any; delay: number }> } {
  const executeCalls: Array<{ call: any; delay: number }> = []
  
  return {
    executeCalls,
    execute: vi.fn(async (call, context) => {
      const start = Date.now()
      executeCalls.push({ call, delay: 0 })
      
      // Simulate some async work
      await new Promise(resolve => setTimeout(resolve, 10))
      
      const result: ToolResult = {
        toolCallId: call.toolCallId,
        output: { result: `${call.toolName}-output` },
        isError: false,
      }
      
      executeCalls[executeCalls.length - 1]!.delay = Date.now() - start
      return result
    }),
    recordRejection: vi.fn(),
  }
}

function createMockUiBus(): { bus: UiBus; events: UiEvent[] } {
  const events: UiEvent[] = []
  return {
    bus: {
      events$: { subscribe: vi.fn() },
      emit: vi.fn((event: UiEvent) => events.push(event)),
    },
    events,
  }
}

describe('OutputHandler.handleToolCalls - Batch Execution', () => {
  let handler: OutputHandler
  let mockRegistry: ToolRegistry
  let mockExecutor: ReturnType<typeof createMockExecutor>
  let mockConversationManager: any
  let mockUiBus: ReturnType<typeof createMockUiBus>

  const baseCtx = {
    taskId: 'task-1',
    agentId: 'agent-1',
    baseDir: '/tmp',
    conversationHistory: [] as any[],
    persistMessage: vi.fn(),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockExecutor = createMockExecutor()
    mockConversationManager = {
      getPendingToolCalls: vi.fn(),
      persistToolResultIfMissing: vi.fn(),
    }
    mockUiBus = createMockUiBus()
  })

  describe('empty and single-call cases', () => {
    it('should return empty result for empty calls array', async () => {
      const tools = new Map<string, Tool>()
      mockRegistry = createMockRegistry(tools)
      
      handler = new OutputHandler({
        toolRegistry: mockRegistry,
        toolExecutor: mockExecutor,
        conversationManager: mockConversationManager,
        artifactStore: {} as any,
        uiBus: mockUiBus.bus,
      })

      const result = await handler.handleToolCalls([], baseCtx)
      
      expect(result).toEqual({})
      expect(mockExecutor.execute).not.toHaveBeenCalled()
    })

    it('should delegate single call to handleSingleToolCall', async () => {
      const safeTool = createMockTool('readFile', 'safe')
      const tools = new Map([['readFile', safeTool]])
      mockRegistry = createMockRegistry(tools)
      
      handler = new OutputHandler({
        toolRegistry: mockRegistry,
        toolExecutor: mockExecutor,
        conversationManager: mockConversationManager,
        artifactStore: {} as any,
        uiBus: mockUiBus.bus,
      })

      const calls = [
        { toolCallId: 'tc-1', toolName: 'readFile', arguments: { path: '/tmp/a.txt' } }
      ]

      const result = await handler.handleToolCalls(calls, baseCtx)
      
      expect(result).toEqual({})
      expect(mockExecutor.execute).toHaveBeenCalledTimes(1)
      expect(mockExecutor.execute).toHaveBeenCalledWith(
        calls[0],
        expect.objectContaining({ taskId: 'task-1' })
      )
    })
  })

  describe('concurrent safe tool execution', () => {
    it('should execute multiple safe tools concurrently', async () => {
      const readFileTool = createMockTool('readFile', 'safe')
      const globTool = createMockTool('glob', 'safe')
      const grepTool = createMockTool('grep', 'safe')
      
      const tools = new Map([
        ['readFile', readFileTool],
        ['glob', globTool],
        ['grep', grepTool],
      ])
      mockRegistry = createMockRegistry(tools)
      
      handler = new OutputHandler({
        toolRegistry: mockRegistry,
        toolExecutor: mockExecutor,
        conversationManager: mockConversationManager,
        artifactStore: {} as any,
        uiBus: mockUiBus.bus,
      })

      const calls = [
        { toolCallId: 'tc-1', toolName: 'readFile', arguments: { path: '/tmp/a.txt' } },
        { toolCallId: 'tc-2', toolName: 'glob', arguments: { pattern: '*.ts' } },
        { toolCallId: 'tc-3', toolName: 'grep', arguments: { pattern: 'import' } },
      ]

      const startTime = Date.now()
      await handler.handleToolCalls(calls, baseCtx)
      const totalTime = Date.now() - startTime

      // All 3 tools should be executed
      expect(mockExecutor.execute).toHaveBeenCalledTimes(3)
      
      // Concurrent execution should be faster than sequential (3 * 10ms = 30ms)
      // With concurrency, it should be around 10-20ms
      expect(totalTime).toBeLessThan(35)
      
      // Verify batch events were emitted
      const batchStartEvents = mockUiBus.events.filter(e => e.type === 'tool_calls_batch_start')
      const batchEndEvents = mockUiBus.events.filter(e => e.type === 'tool_calls_batch_end')
      
      expect(batchStartEvents).toHaveLength(1)
      expect(batchStartEvents[0]).toMatchObject({
        type: 'tool_calls_batch_start',
        payload: { taskId: 'task-1', count: 3, safeCount: 3, riskyCount: 0 },
      })
      expect(batchEndEvents).toHaveLength(1)
    })

    it('should emit tool_call_start/end for each concurrent tool', async () => {
      const readFileTool = createMockTool('readFile', 'safe')
      const globTool = createMockTool('glob', 'safe')
      
      const tools = new Map([
        ['readFile', readFileTool],
        ['glob', globTool],
      ])
      mockRegistry = createMockRegistry(tools)
      
      handler = new OutputHandler({
        toolRegistry: mockRegistry,
        toolExecutor: mockExecutor,
        conversationManager: mockConversationManager,
        artifactStore: {} as any,
        uiBus: mockUiBus.bus,
      })

      const calls = [
        { toolCallId: 'tc-1', toolName: 'readFile', arguments: { path: '/tmp/a.txt' } },
        { toolCallId: 'tc-2', toolName: 'glob', arguments: { pattern: '*.ts' } },
      ]

      await handler.handleToolCalls(calls, baseCtx)

      const startEvents = mockUiBus.events.filter(e => e.type === 'tool_call_start')
      const endEvents = mockUiBus.events.filter(e => e.type === 'tool_call_end')
      
      expect(startEvents).toHaveLength(2)
      expect(endEvents).toHaveLength(2)
      
      // Verify tool call IDs are present
      const startIds = startEvents.map(e => (e as any).payload.toolCallId)
      expect(startIds).toContain('tc-1')
      expect(startIds).toContain('tc-2')
    })

    it('should persist all tool results to conversation', async () => {
      const readFileTool = createMockTool('readFile', 'safe')
      const globTool = createMockTool('glob', 'safe')
      
      const tools = new Map([
        ['readFile', readFileTool],
        ['glob', globTool],
      ])
      mockRegistry = createMockRegistry(tools)
      
      handler = new OutputHandler({
        toolRegistry: mockRegistry,
        toolExecutor: mockExecutor,
        conversationManager: mockConversationManager,
        artifactStore: {} as any,
        uiBus: mockUiBus.bus,
      })

      const calls = [
        { toolCallId: 'tc-1', toolName: 'readFile', arguments: { path: '/tmp/a.txt' } },
        { toolCallId: 'tc-2', toolName: 'glob', arguments: { pattern: '*.ts' } },
      ]

      await handler.handleToolCalls(calls, baseCtx)

      expect(mockConversationManager.persistToolResultIfMissing).toHaveBeenCalledTimes(2)
      expect(mockConversationManager.persistToolResultIfMissing).toHaveBeenCalledWith(
        'task-1', 'tc-1', 'readFile',
        expect.anything(), false, expect.anything(), expect.anything()
      )
      expect(mockConversationManager.persistToolResultIfMissing).toHaveBeenCalledWith(
        'task-1', 'tc-2', 'glob',
        expect.anything(), false, expect.anything(), expect.anything()
      )
    })
  })

  describe('mixed safe and risky tools', () => {
    it('should execute safe tools concurrently, then risky tools sequentially', async () => {
      const readFileTool = createMockTool('readFile', 'safe')
      const editFileTool = createMockTool('editFile', 'risky')
      const runCommandTool = createMockTool('runCommand', 'risky')
      
      const tools = new Map([
        ['readFile', readFileTool],
        ['editFile', editFileTool],
        ['runCommand', runCommandTool],
      ])
      mockRegistry = createMockRegistry(tools)
      
      handler = new OutputHandler({
        toolRegistry: mockRegistry,
        toolExecutor: mockExecutor,
        conversationManager: mockConversationManager,
        artifactStore: {} as any,
        uiBus: mockUiBus.bus,
      })

      const calls = [
        { toolCallId: 'tc-1', toolName: 'readFile', arguments: { path: '/tmp/a.txt' } },
        { toolCallId: 'tc-2', toolName: 'editFile', arguments: { path: '/tmp/a.txt', oldString: 'a', newString: 'b' } },
        { toolCallId: 'tc-3', toolName: 'runCommand', arguments: { command: 'echo test' } },
      ]

      const result = await handler.handleToolCalls(calls, baseCtx)

      // Safe tool should be executed
      expect(mockExecutor.execute).toHaveBeenCalledWith(
        expect.objectContaining({ toolCallId: 'tc-1' }),
        expect.anything()
      )
      
      // First risky tool should trigger UIP pause
      expect(result.pause).toBe(true)
      expect(result.event?.type).toBe('UserInteractionRequested')
      
      // Batch end should be emitted even when paused
      const batchEndEvents = mockUiBus.events.filter(e => e.type === 'tool_calls_batch_end')
      expect(batchEndEvents).toHaveLength(1)
    })

    it('should partition tools correctly by risk level', async () => {
      const readFileTool = createMockTool('readFile', 'safe')
      const globTool = createMockTool('glob', 'safe')
      const editFileTool = createMockTool('editFile', 'risky')
      
      const tools = new Map([
        ['readFile', readFileTool],
        ['glob', globTool],
        ['editFile', editFileTool],
      ])
      mockRegistry = createMockRegistry(tools)
      
      handler = new OutputHandler({
        toolRegistry: mockRegistry,
        toolExecutor: mockExecutor,
        conversationManager: mockConversationManager,
        artifactStore: {} as any,
        uiBus: mockUiBus.bus,
      })

      const calls = [
        { toolCallId: 'tc-1', toolName: 'readFile', arguments: {} },
        { toolCallId: 'tc-2', toolName: 'editFile', arguments: {} },
        { toolCallId: 'tc-3', toolName: 'glob', arguments: {} },
      ]

      await handler.handleToolCalls(calls, baseCtx)

      // Verify batch start shows correct counts
      const batchStartEvents = mockUiBus.events.filter(e => e.type === 'tool_calls_batch_start')
      expect(batchStartEvents[0]?.payload).toMatchObject({
        count: 3,
        safeCount: 2,
        riskyCount: 1,
      })
    })
  })

  describe('all risky tools', () => {
    it('should process all risky tools sequentially with UIP confirmation', async () => {
      const editFileTool = createMockTool('editFile', 'risky')
      const runCommandTool = createMockTool('runCommand', 'risky')
      
      const tools = new Map([
        ['editFile', editFileTool],
        ['runCommand', runCommandTool],
      ])
      mockRegistry = createMockRegistry(tools)
      
      handler = new OutputHandler({
        toolRegistry: mockRegistry,
        toolExecutor: mockExecutor,
        conversationManager: mockConversationManager,
        artifactStore: {} as any,
        uiBus: mockUiBus.bus,
      })

      const calls = [
        { toolCallId: 'tc-1', toolName: 'editFile', arguments: { path: '/tmp/a.txt' } },
        { toolCallId: 'tc-2', toolName: 'runCommand', arguments: { command: 'echo test' } },
      ]

      const result = await handler.handleToolCalls(calls, baseCtx)

      // First risky tool should trigger UIP pause
      expect(result.pause).toBe(true)
      expect(result.event?.type).toBe('UserInteractionRequested')
      
      // No tools should be executed yet (waiting for confirmation)
      expect(mockExecutor.execute).not.toHaveBeenCalled()
    })
  })

  describe('error handling in concurrent execution', () => {
    it('should continue executing other tools if one fails', async () => {
      const readFileTool = createMockTool('readFile', 'safe')
      const globTool = createMockTool('glob', 'safe')
      
      const tools = new Map([
        ['readFile', readFileTool],
        ['glob', globTool],
      ])
      mockRegistry = createMockRegistry(tools)
      
      // Make readFile fail
      ;(mockExecutor.execute as Mock).mockImplementation(async (call) => {
        if (call.toolName === 'readFile') {
          return {
            toolCallId: call.toolCallId,
            output: { error: 'File not found' },
            isError: true,
          }
        }
        return {
          toolCallId: call.toolCallId,
          output: { files: ['a.ts', 'b.ts'] },
          isError: false,
        }
      })
      
      handler = new OutputHandler({
        toolRegistry: mockRegistry,
        toolExecutor: mockExecutor,
        conversationManager: mockConversationManager,
        artifactStore: {} as any,
        uiBus: mockUiBus.bus,
      })

      const calls = [
        { toolCallId: 'tc-1', toolName: 'readFile', arguments: { path: '/tmp/missing.txt' } },
        { toolCallId: 'tc-2', toolName: 'glob', arguments: { pattern: '*.ts' } },
      ]

      await handler.handleToolCalls(calls, baseCtx)

      // Both tools should have been executed
      expect(mockExecutor.execute).toHaveBeenCalledTimes(2)
      
      // Both results should be persisted
      expect(mockConversationManager.persistToolResultIfMissing).toHaveBeenCalledTimes(2)
    })

    it('should handle unknown tools gracefully', async () => {
      const readFileTool = createMockTool('readFile', 'safe')
      
      const tools = new Map([['readFile', readFileTool]])
      mockRegistry = createMockRegistry(tools)
      
      handler = new OutputHandler({
        toolRegistry: mockRegistry,
        toolExecutor: mockExecutor,
        conversationManager: mockConversationManager,
        artifactStore: {} as any,
        uiBus: mockUiBus.bus,
      })

      const calls = [
        { toolCallId: 'tc-1', toolName: 'readFile', arguments: {} },
        { toolCallId: 'tc-2', toolName: 'unknownTool', arguments: {} },
      ]

      await handler.handleToolCalls(calls, baseCtx)

      // Unknown tool should be treated as safe (no riskLevel)
      // Both should be executed
      expect(mockExecutor.execute).toHaveBeenCalledTimes(2)
    })
  })

  describe('canExecute pre-check', () => {
    it('should run canExecute for each safe tool in concurrent execution', async () => {
      const readFileTool: Tool = {
        name: 'readFile',
        description: 'safe',
        parameters: { type: 'object', properties: {} },
        group: 'test',
        riskLevel: 'safe',
        canExecute: vi.fn().mockResolvedValue(undefined),
        execute: vi.fn().mockResolvedValue({ content: 'file content' }),
      }
      
      const globTool: Tool = {
        name: 'glob',
        description: 'safe',
        parameters: { type: 'object', properties: {} },
        group: 'test',
        riskLevel: 'safe',
        canExecute: vi.fn().mockResolvedValue(undefined),
        execute: vi.fn().mockResolvedValue({ files: [] }),
      }
      
      const tools = new Map([
        ['readFile', readFileTool],
        ['glob', globTool],
      ])
      mockRegistry = createMockRegistry(tools)
      
      handler = new OutputHandler({
        toolRegistry: mockRegistry,
        toolExecutor: mockExecutor,
        conversationManager: mockConversationManager,
        artifactStore: {} as any,
        uiBus: mockUiBus.bus,
      })

      const calls = [
        { toolCallId: 'tc-1', toolName: 'readFile', arguments: { path: '/tmp/a.txt' } },
        { toolCallId: 'tc-2', toolName: 'glob', arguments: { pattern: '*.ts' } },
      ]

      await handler.handleToolCalls(calls, baseCtx)

      // canExecute should be called for both tools
      expect(readFileTool.canExecute).toHaveBeenCalledTimes(1)
      expect(globTool.canExecute).toHaveBeenCalledTimes(1)
    })

    it('should skip execution and persist error if canExecute fails', async () => {
      const readFileTool: Tool = {
        name: 'readFile',
        description: 'safe',
        parameters: { type: 'object', properties: {} },
        group: 'test',
        riskLevel: 'safe',
        canExecute: vi.fn().mockRejectedValue(new Error('Permission denied')),
        execute: vi.fn(),
      }
      
      const globTool: Tool = {
        name: 'glob',
        description: 'safe',
        parameters: { type: 'object', properties: {} },
        group: 'test',
        riskLevel: 'safe',
        execute: vi.fn().mockResolvedValue({ files: [] }),
      }
      
      const tools = new Map([
        ['readFile', readFileTool],
        ['glob', globTool],
      ])
      mockRegistry = createMockRegistry(tools)
      
      handler = new OutputHandler({
        toolRegistry: mockRegistry,
        toolExecutor: mockExecutor,
        conversationManager: mockConversationManager,
        artifactStore: {} as any,
        uiBus: mockUiBus.bus,
      })

      const calls = [
        { toolCallId: 'tc-1', toolName: 'readFile', arguments: { path: '/tmp/a.txt' } },
        { toolCallId: 'tc-2', toolName: 'glob', arguments: { pattern: '*.ts' } },
      ]

      await handler.handleToolCalls(calls, baseCtx)

      // readFile should not be executed (canExecute failed)
      // glob should still be executed
      expect(mockExecutor.execute).toHaveBeenCalledTimes(1)
      expect(mockExecutor.execute).toHaveBeenCalledWith(
        expect.objectContaining({ toolCallId: 'tc-2' }),
        expect.anything()
      )
      
      // Error should be persisted for readFile
      expect(mockConversationManager.persistToolResultIfMissing).toHaveBeenCalledWith(
        'task-1', 'tc-1', 'readFile',
        { error: 'Permission denied' },
        true,
        expect.anything(),
        expect.anything()
      )
    })
  })
})
