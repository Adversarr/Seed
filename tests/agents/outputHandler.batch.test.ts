import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OutputHandler } from '../../src/agents/orchestration/outputHandler.js'
import type { Tool, ToolExecutor, ToolRegistry, ToolResult } from '../../src/core/ports/tool.js'
import type { UiBus, UiEvent } from '../../src/core/ports/uiBus.js'

function makeTool(name: string, riskLevel: 'safe' | 'risky', canExecute?: Tool['canExecute']): Tool {
  return {
    name,
    description: `${riskLevel} tool`,
    parameters: { type: 'object', properties: {} },
    group: 'test',
    riskLevel,
    canExecute,
    execute: vi.fn(),
  }
}

function makeRegistry(tools: Map<string, Tool>): ToolRegistry {
  return {
    get: vi.fn((name: string) => tools.get(name)),
    register: vi.fn(),
    list: vi.fn(() => [...tools.values()]),
    listByGroups: vi.fn(() => [...tools.values()]),
    toOpenAIFormat: vi.fn(() => []),
    toOpenAIFormatByGroups: vi.fn(() => []),
  }
}

function makeUiBus(): { bus: UiBus; events: UiEvent[] } {
  const events: UiEvent[] = []
  return {
    bus: {
      events$: { subscribe: vi.fn() },
      emit: vi.fn((event: UiEvent) => events.push(event)),
    },
    events,
  }
}

function makeExecutor(
  impl?: (call: { toolCallId: string; toolName: string }) => Promise<ToolResult>
): ToolExecutor & { execute: ReturnType<typeof vi.fn> } {
  return {
    execute: vi.fn(async (call) => {
      if (impl) return impl(call)
      return { toolCallId: call.toolCallId, output: { ok: true }, isError: false }
    }),
    recordRejection: vi.fn(),
  }
}

describe('OutputHandler.handleToolCalls', () => {
  const baseCtx = {
    taskId: 'task-1',
    agentId: 'agent-1',
    baseDir: '/tmp',
    conversationHistory: [] as any[],
    persistMessage: vi.fn(),
  }

  let mockConversationManager: any

  beforeEach(() => {
    vi.clearAllMocks()
    mockConversationManager = {
      getPendingToolCalls: vi.fn(),
      persistToolResultIfMissing: vi.fn(),
    }
  })

  it('returns empty result for empty call list', async () => {
    const registry = makeRegistry(new Map())
    const executor = makeExecutor()
    const handler = new OutputHandler({
      toolRegistry: registry,
      toolExecutor: executor,
      conversationManager: mockConversationManager,
      artifactStore: {} as any,
    })

    const result = await handler.handleToolCalls([], baseCtx)
    expect(result).toEqual({})
    expect(executor.execute).not.toHaveBeenCalled()
  })

  it('preserves order barriers: safe before risky executes, trailing safe waits for confirmation', async () => {
    const tools = new Map<string, Tool>([
      ['readFile', makeTool('readFile', 'safe')],
      ['editFile', makeTool('editFile', 'risky')],
      ['glob', makeTool('glob', 'safe')],
    ])
    const registry = makeRegistry(tools)
    const executor = makeExecutor()
    const ui = makeUiBus()

    const handler = new OutputHandler({
      toolRegistry: registry,
      toolExecutor: executor,
      conversationManager: mockConversationManager,
      artifactStore: {} as any,
      uiBus: ui.bus,
    })

    const result = await handler.handleToolCalls(
      [
        { toolCallId: 'tc-safe-1', toolName: 'readFile', arguments: {} },
        { toolCallId: 'tc-risky', toolName: 'editFile', arguments: {} },
        { toolCallId: 'tc-safe-2', toolName: 'glob', arguments: {} },
      ],
      baseCtx
    )

    expect(result.pause).toBe(true)
    expect(result.event?.type).toBe('UserInteractionRequested')
    expect(executor.execute).toHaveBeenCalledTimes(1)
    expect(executor.execute).toHaveBeenCalledWith(
      expect.objectContaining({ toolCallId: 'tc-safe-1' }),
      expect.anything()
    )
  })

  it('runs contiguous safe calls concurrently within a segment', async () => {
    const tools = new Map<string, Tool>([
      ['readFile', makeTool('readFile', 'safe')],
      ['glob', makeTool('glob', 'safe')],
    ])
    const registry = makeRegistry(tools)

    const resolvers: Record<string, () => void> = {}
    const started: string[] = []
    const executor = makeExecutor(async (call) => {
      started.push(call.toolCallId)
      await new Promise<void>((resolve) => {
        resolvers[call.toolCallId] = resolve
      })
      return { toolCallId: call.toolCallId, output: { ok: true }, isError: false }
    })

    const handler = new OutputHandler({
      toolRegistry: registry,
      toolExecutor: executor,
      conversationManager: mockConversationManager,
      artifactStore: {} as any,
    })

    const run = handler.handleToolCalls(
      [
        { toolCallId: 'tc-1', toolName: 'readFile', arguments: {} },
        { toolCallId: 'tc-2', toolName: 'glob', arguments: {} },
      ],
      baseCtx
    )

    // Both should have started without waiting for the first one to complete.
    await Promise.resolve()
    expect(started).toEqual(expect.arrayContaining(['tc-1', 'tc-2']))

    resolvers['tc-1']?.()
    resolvers['tc-2']?.()
    await run
  })

  it('propagates hard failures from concurrent safe segment', async () => {
    const tools = new Map<string, Tool>([
      ['readFile', makeTool('readFile', 'safe')],
      ['glob', makeTool('glob', 'safe')],
    ])
    const registry = makeRegistry(tools)
    const executor = makeExecutor()

    mockConversationManager.persistToolResultIfMissing
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('db unavailable'))

    const handler = new OutputHandler({
      toolRegistry: registry,
      toolExecutor: executor,
      conversationManager: mockConversationManager,
      artifactStore: {} as any,
    })

    await expect(
      handler.handleToolCalls(
        [
          { toolCallId: 'tc-1', toolName: 'readFile', arguments: {} },
          { toolCallId: 'tc-2', toolName: 'glob', arguments: {} },
        ],
        baseCtx
      )
    ).rejects.toThrow('Concurrent tool segment failed')
  })

  it('emits batch start and end even when batch pauses on risky confirmation', async () => {
    const tools = new Map<string, Tool>([
      ['readFile', makeTool('readFile', 'safe')],
      ['editFile', makeTool('editFile', 'risky')],
    ])
    const registry = makeRegistry(tools)
    const executor = makeExecutor()
    const ui = makeUiBus()

    const handler = new OutputHandler({
      toolRegistry: registry,
      toolExecutor: executor,
      conversationManager: mockConversationManager,
      artifactStore: {} as any,
      uiBus: ui.bus,
    })

    const result = await handler.handleToolCalls(
      [
        { toolCallId: 'tc-safe', toolName: 'readFile', arguments: {} },
        { toolCallId: 'tc-risky', toolName: 'editFile', arguments: {} },
      ],
      baseCtx
    )

    expect(result.pause).toBe(true)
    expect(ui.events.some((e) => e.type === 'tool_calls_batch_start')).toBe(true)
    expect(ui.events.some((e) => e.type === 'tool_calls_batch_end')).toBe(true)
  })

  it('emits heartbeats while a long-running tool is executing', async () => {
    const tools = new Map<string, Tool>([['readFile', makeTool('readFile', 'safe')]])
    const registry = makeRegistry(tools)
    const ui = makeUiBus()

    const executor = makeExecutor(async (call) => {
      await new Promise((resolve) => setTimeout(resolve, 25))
      return { toolCallId: call.toolCallId, output: { ok: true }, isError: false }
    })

    const handler = new OutputHandler({
      toolRegistry: registry,
      toolExecutor: executor,
      conversationManager: mockConversationManager,
      artifactStore: {} as any,
      uiBus: ui.bus,
      toolHeartbeatMs: 5,
    })

    await handler.handle({
      kind: 'tool_call',
      call: { toolCallId: 'tc-1', toolName: 'readFile', arguments: {} },
    }, baseCtx)

    const heartbeatEvents = ui.events.filter((event) => event.type === 'tool_call_heartbeat')
    expect(heartbeatEvents.length).toBeGreaterThan(0)
  })
})
