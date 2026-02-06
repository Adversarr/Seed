import { describe, it, expect, vi } from 'vitest'
import { DefaultCoAuthorAgent } from '../../src/agents/defaultAgent.js'
import { ContextBuilder } from '../../src/application/contextBuilder.js'
import type { AgentContext } from '../../src/agents/agent.js'
import type { TaskView } from '../../src/application/taskService.js'
import type { ToolRegistry, Tool } from '../../src/domain/ports/tool.js'
import type { LLMClient, LLMMessage } from '../../src/domain/ports/llmClient.js'

describe('DefaultCoAuthorAgent Rejection Handling', () => {
  const contextBuilder = new ContextBuilder('/tmp')
  const agent = new DefaultCoAuthorAgent({ contextBuilder })

  const mockTask: TaskView = {
    taskId: 't1',
    title: 'Test Task',
    intent: 'Test',
    createdBy: 'u1',
    agentId: 'a1',
    priority: 'normal',
    status: 'in_progress',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }

  const mockTool: Tool = {
    name: 'riskyTool',
    description: 'Risky tool',
    parameters: { type: 'object', properties: {} },
    riskLevel: 'risky',
    execute: async () => ({ toolCallId: '1', output: { executed: true }, isError: false })
  }

  const mockTools: ToolRegistry = {
    register: vi.fn(),
    get: vi.fn().mockReturnValue(mockTool),
    list: vi.fn().mockReturnValue([mockTool]),
    toOpenAIFormat: vi.fn().mockReturnValue([])
  }

  const mockLLM: LLMClient = {
    complete: vi.fn().mockResolvedValue({
      toolCalls: [],
      content: 'Done'
    }),
    stream: vi.fn()
  }

  it('should handle tool rejection on resume', async () => {
    // Setup history with pending tool call
    const history: LLMMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'task' },
      { 
        role: 'assistant', 
        toolCalls: [{
          toolCallId: 'call_1',
          toolName: 'riskyTool',
          arguments: {}
        }]
      }
    ]

    const persistMessage = vi.fn()

    const mockContext: AgentContext = {
      llm: mockLLM,
      tools: mockTools,
      baseDir: '/tmp',
      conversationHistory: history,
      persistMessage,
      pendingInteractionResponse: {
        interactionId: 'ui_1',
        selectedOptionId: 'reject', // User rejected
        payload: {}
      },
      confirmedInteractionId: undefined // Not approved
    }

    const generator = agent.run(mockTask, mockContext)

    // 1. Expect text yield "Skipping tool..."
    const result1 = await generator.next()
    expect(result1.value).toMatchObject({ 
      kind: 'verbose',
      content: expect.stringContaining('User rejected')
    })

    // 2. Expect iteration verbose (this advances the generator past the persistMessage call)
    const result2 = await generator.next()
    expect(result2.value).toMatchObject({ kind: 'verbose', content: expect.stringContaining('Iteration') })

    // Now expect persisted rejection message
    expect(persistMessage).toHaveBeenCalledWith(expect.objectContaining({
      role: 'tool',
      toolCallId: 'call_1',
      content: expect.stringContaining('User rejected')
    }))
  })

  it('should handle tool approval on resume', async () => {
    // Setup history with pending tool call
    const history: LLMMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'task' },
      { 
        role: 'assistant', 
        toolCalls: [{
          toolCallId: 'call_1',
          toolName: 'riskyTool',
          arguments: {}
        }]
      }
    ]

    const persistMessage = vi.fn()

    const mockContext: AgentContext = {
      llm: mockLLM,
      tools: mockTools,
      baseDir: '/tmp',
      conversationHistory: history,
      persistMessage,
      pendingInteractionResponse: {
        interactionId: 'ui_1',
        selectedOptionId: 'approve', 
        payload: {}
      },
      confirmedInteractionId: 'ui_1' // Approved
    }

    const generator = agent.run(mockTask, mockContext)

    // 1. Expect "Executing tool" verbose
    const result1 = await generator.next()
    expect(result1.value).toMatchObject({ 
      kind: 'verbose',
      content: expect.stringContaining('Executing tool')
    })

    // 2. Expect tool_call
    const result2 = await generator.next()
    expect(result2.value).toMatchObject({ 
      kind: 'tool_call',
      call: { toolCallId: 'call_1' }
    })
  })
})
