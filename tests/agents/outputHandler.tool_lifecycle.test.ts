import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { OutputHandler } from '../../src/agents/orchestration/outputHandler.js'
import type { Tool, ToolContext } from '../../src/core/ports/tool.js'
import type { ToolRegistry } from '../../src/core/ports/tool.js'
import type { ToolExecutor } from '../../src/core/ports/tool.js'
import { DefaultSkillRegistry } from '../../src/infrastructure/skills/skillRegistry.js'
import { SkillManager } from '../../src/infrastructure/skills/skillManager.js'
import { createActivateSkillTool } from '../../src/infrastructure/tools/activateSkill.js'

describe('OutputHandler Tool Lifecycle', () => {
  let handler: OutputHandler
  let mockRegistry: ToolRegistry
  let mockExecutor: ToolExecutor
  let mockConversationManager: any
  
  const ctx = {
    taskId: 't1',
    agentId: 'a1',
    baseDir: '/tmp',
    conversationHistory: [],
    persistMessage: vi.fn()
  }

  beforeEach(() => {
    mockRegistry = {
      get: vi.fn(),
      register: vi.fn(),
      list: vi.fn(),
      toOpenAIFormat: vi.fn()
    }
    mockExecutor = {
      execute: vi.fn().mockResolvedValue({ toolCallId: '1', output: 'done', isError: false }),
      recordRejection: vi.fn((call) => ({ toolCallId: call.toolCallId, output: { isError: true, error: 'User rejected the request' }, isError: true }))
    }
    mockConversationManager = {
      getPendingToolCalls: vi.fn(),
      persistToolResultIfMissing: vi.fn()
    }

    handler = new OutputHandler({
      toolRegistry: mockRegistry,
      toolExecutor: mockExecutor,
      conversationManager: mockConversationManager,
      artifactStore: {} as any
    })
  })

  it('should skip execution if safe tool fails canExecute', async () => {
    const safeTool: Tool = {
      name: 'safe-tool',
      description: 'safe',
      parameters: { type: 'object', properties: {} },
      group: 'search',
      riskLevel: () => 'safe',
      canExecute: vi.fn().mockRejectedValue(new Error('Pre-check failed')),
      execute: vi.fn()
    }
    
    vi.mocked(mockRegistry.get).mockReturnValue(safeTool)

    await handler.handle({
      kind: 'tool_call',
      call: { toolCallId: '1', toolName: 'safe-tool', arguments: {} }
    }, ctx)

    expect(safeTool.canExecute).toHaveBeenCalled()
    expect(mockExecutor.execute).not.toHaveBeenCalled()
    expect(mockConversationManager.persistToolResultIfMissing).toHaveBeenCalledWith(
      expect.anything(), '1', 'safe-tool', { error: 'Pre-check failed' }, true, expect.anything(), expect.anything()
    )
  })

  it('should skip approval if risky tool fails canExecute', async () => {
    const riskyTool: Tool = {
      name: 'risky-tool',
      description: 'risky',
      parameters: { type: 'object', properties: {} },
      group: 'search',
      riskLevel: () => 'risky',
      canExecute: vi.fn().mockRejectedValue(new Error('Pre-check failed')),
      execute: vi.fn()
    }
    
    vi.mocked(mockRegistry.get).mockReturnValue(riskyTool)

    const result = await handler.handle({
      kind: 'tool_call',
      call: { toolCallId: '1', toolName: 'risky-tool', arguments: {} }
    }, ctx)

    expect(result.pause).toBeUndefined()
    expect(result.event).toBeUndefined()
    expect(mockExecutor.execute).not.toHaveBeenCalled()
  })

  it('should pause for approval if risky tool passes canExecute', async () => {
    const riskyTool: Tool = {
      name: 'risky-tool',
      description: 'risky',
      parameters: { type: 'object', properties: {} },
      group: 'search',
      riskLevel: () => 'risky',
      canExecute: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn()
    }
    
    vi.mocked(mockRegistry.get).mockReturnValue(riskyTool)

    const result = await handler.handle({
      kind: 'tool_call',
      call: { toolCallId: '1', toolName: 'risky-tool', arguments: {} }
    }, ctx)

    expect(result.pause).toBe(true)
    expect(result.event?.type).toBe('UserInteractionRequested')
    expect(mockExecutor.execute).not.toHaveBeenCalled()
  })

  it('should execute safe tool if canExecute passes', async () => {
    const safeTool: Tool = {
      name: 'safe-tool',
      description: 'safe',
      parameters: { type: 'object', properties: {} },
      group: 'search',
      riskLevel: () => 'safe',
      canExecute: vi.fn().mockResolvedValue(undefined),
      execute: vi.fn()
    }
    
    vi.mocked(mockRegistry.get).mockReturnValue(safeTool)

    await handler.handle({
      kind: 'tool_call',
      call: { toolCallId: '1', toolName: 'safe-tool', arguments: {} }
    }, ctx)

    expect(safeTool.canExecute).toHaveBeenCalled()
    expect(mockExecutor.execute).toHaveBeenCalled()
  })

  it('should record rejection audit entries via handleRejections', async () => {
    const persistMessage = vi.fn()
    const rejectionCtx = {
      taskId: 't1',
      agentId: 'a1',
      baseDir: '/tmp',
      conversationHistory: [
        {
          role: 'assistant' as const,
          toolCalls: [
            { toolCallId: 'tc1', toolName: 'risky-tool', arguments: { path: 'f.txt' } }
          ]
        }
      ],
      persistMessage
    }

    const riskyTool: Tool = {
      name: 'risky-tool',
      description: 'risky',
      parameters: { type: 'object', properties: {} },
      group: 'search',
      riskLevel: () => 'risky',
      execute: vi.fn()
    }
    vi.mocked(mockRegistry.get).mockReturnValue(riskyTool)
    vi.mocked(mockConversationManager.getPendingToolCalls).mockReturnValue([
      { toolCallId: 'tc1', toolName: 'risky-tool', arguments: { path: 'f.txt' } }
    ])

    await handler.handleRejections(rejectionCtx, 'tc1')

    // recordRejection should be called for the dangling tool call
    expect(mockExecutor.recordRejection).toHaveBeenCalledWith(
      { toolCallId: 'tc1', toolName: 'risky-tool', arguments: { path: 'f.txt' } },
      expect.objectContaining({ taskId: 't1', actorId: 'a1' })
    )

    // Conversation persistence should happen
    expect(mockConversationManager.persistToolResultIfMissing).toHaveBeenCalledWith(
      't1', 'tc1', 'risky-tool',
      { isError: true, error: 'User rejected the request' },
      true,
      expect.anything(),
      persistMessage
    )
  })

  it('should not call recordRejection when tool result already exists', async () => {
    vi.mocked(mockExecutor.recordRejection).mockClear()

    const rejectionCtx = {
      taskId: 't1',
      agentId: 'a1',
      baseDir: '/tmp',
      conversationHistory: [
        {
          role: 'assistant' as const,
          toolCalls: [
            { toolCallId: 'tc2', toolName: 'risky-tool', arguments: {} }
          ]
        },
        {
          role: 'tool' as const,
          toolCallId: 'tc2',
          content: '{"ok": true}'
        }
      ],
      persistMessage: vi.fn()
    }

    vi.mocked(mockConversationManager.getPendingToolCalls).mockReturnValue([])
    await handler.handleRejections(rejectionCtx, 'tc2')

    // No rejection needed — result already exists
    expect(mockExecutor.recordRejection).not.toHaveBeenCalled()
  })

  it('persists rejection even if current risk mode would now mark call safe', async () => {
    const persistMessage = vi.fn()
    const rejectionCtx = {
      taskId: 't1',
      agentId: 'a1',
      baseDir: '/tmp',
      toolRiskMode: 'autorun_all' as const,
      conversationHistory: [
        {
          role: 'assistant' as const,
          toolCalls: [
            { toolCallId: 'tc3', toolName: 'policy-edit', arguments: { path: 'public:/a.txt' } }
          ]
        }
      ],
      persistMessage
    }

    const policyTool: Tool = {
      name: 'policy-edit',
      description: 'policy tool',
      parameters: { type: 'object', properties: {} },
      group: 'edit',
      riskLevel: (_args, toolCtx: ToolContext) => toolCtx.toolRiskMode === 'autorun_all' ? 'safe' : 'risky',
      execute: vi.fn()
    }

    vi.mocked(mockRegistry.get).mockReturnValue(policyTool)
    vi.mocked(mockConversationManager.getPendingToolCalls).mockReturnValue([
      { toolCallId: 'tc3', toolName: 'policy-edit', arguments: { path: 'public:/a.txt' } }
    ])

    await handler.handleRejections(rejectionCtx, 'tc3')

    expect(mockExecutor.recordRejection).toHaveBeenCalledWith(
      { toolCallId: 'tc3', toolName: 'policy-edit', arguments: { path: 'public:/a.txt' } },
      expect.objectContaining({ toolRiskMode: 'autorun_all' })
    )
    expect(mockConversationManager.persistToolResultIfMissing).toHaveBeenCalledWith(
      't1',
      'tc3',
      'policy-edit',
      { isError: true, error: 'User rejected the request' },
      true,
      expect.anything(),
      persistMessage
    )
  })

  it('handles activateSkill consent once per task and auto-runs repeat activations', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-output-handler-skill-'))
    mkdirSync(join(dir, 'skills', 'repo-survey'), { recursive: true })
    writeFileSync(
      join(dir, 'skills', 'repo-survey', 'SKILL.md'),
      [
        '---',
        'name: repo-survey',
        'description: Survey the repo before implementation.',
        '---',
        '',
        '# Repo Survey',
        '',
        'Follow the checklist.',
      ].join('\n'),
      'utf8'
    )

    const skillRegistry = new DefaultSkillRegistry()
    const skillManager = new SkillManager({ baseDir: dir, registry: skillRegistry })
    await skillManager.discoverWorkspaceSkills()
    skillManager.setTaskVisibleSkills('t1', ['repo-survey'])

    const activateSkillTool = createActivateSkillTool({ skillManager })
    const persistToolResultIfMissing = vi.fn(async () => {})
    const localConversationManager = {
      getPendingToolCalls: vi.fn(),
      persistToolResultIfMissing
    }
    const localRegistry: ToolRegistry = {
      register: vi.fn(),
      get: vi.fn((name: string) => (name === 'activateSkill' ? activateSkillTool : undefined)),
      list: vi.fn(() => [activateSkillTool]),
      listByGroups: vi.fn(() => [activateSkillTool]),
      toOpenAIFormat: vi.fn(() => []),
      toOpenAIFormatByGroups: vi.fn(() => [])
    }
    const localExecutor: ToolExecutor = {
      execute: vi.fn(async (call, toolCtx) => activateSkillTool.execute(call.arguments, toolCtx)),
      recordRejection: vi.fn((call) => ({
        toolCallId: call.toolCallId,
        output: { isError: true, error: 'User rejected the request' },
        isError: true
      }))
    }

    const localHandler = new OutputHandler({
      toolRegistry: localRegistry,
      toolExecutor: localExecutor,
      conversationManager: localConversationManager as any,
      artifactStore: {} as any
    })

    try {
      const baseCtx = {
        taskId: 't1',
        agentId: 'a1',
        baseDir: dir,
        conversationHistory: [],
        persistMessage: vi.fn()
      }

      const first = await localHandler.handle(
        {
          kind: 'tool_call',
          call: {
            toolCallId: 'tc-activate-1',
            toolName: 'activateSkill',
            arguments: { name: 'repo-survey' }
          }
        },
        { ...baseCtx }
      )
      expect(first.pause).toBe(true)
      expect(localExecutor.execute).not.toHaveBeenCalled()

      const second = await localHandler.handle(
        {
          kind: 'tool_call',
          call: {
            toolCallId: 'tc-activate-1',
            toolName: 'activateSkill',
            arguments: { name: 'repo-survey' }
          }
        },
        {
          ...baseCtx,
          confirmedInteractionId: 'confirm-1',
          confirmedToolCallId: 'tc-activate-1'
        }
      )
      expect(second.pause).toBeUndefined()
      expect(localExecutor.execute).toHaveBeenCalledTimes(1)
      expect(skillManager.isActivationConsentRequired('t1', 'repo-survey')).toBe(false)

      const third = await localHandler.handle(
        {
          kind: 'tool_call',
          call: {
            toolCallId: 'tc-activate-2',
            toolName: 'activateSkill',
            arguments: { name: 'repo-survey' }
          }
        },
        { ...baseCtx }
      )
      expect(third.pause).toBeUndefined()
      expect(localExecutor.execute).toHaveBeenCalledTimes(2)

      const firstPersistedOutput = persistToolResultIfMissing.mock.calls[0]?.[3] as any
      const secondPersistedOutput = persistToolResultIfMissing.mock.calls[1]?.[3] as any
      expect(firstPersistedOutput?.alreadyActivated).toBe(false)
      expect(secondPersistedOutput?.alreadyActivated).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
