import { describe, it, expect, vi } from 'vitest'
import { DefaultCoAuthorAgent } from '../../src/agents/defaultAgent.js'
import { ContextBuilder } from '../../src/application/contextBuilder.js'
import type { AgentContext } from '../../src/agents/agent.js'
import type { TaskView } from '../../src/application/taskService.js'
import type { ToolRegistry, Tool } from '../../src/domain/ports/tool.js'
import type { LLMClient } from '../../src/domain/ports/llmClient.js'

describe('DefaultCoAuthorAgent Diff Generation', () => {
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
    name: 'editFile',
    description: 'Edit file',
    parameters: { type: 'object', properties: {} },
    riskLevel: 'risky',
    execute: async () => ({ toolCallId: '1', output: {}, isError: false })
  }

  const mockTools: ToolRegistry = {
    register: vi.fn(),
    get: vi.fn().mockReturnValue(mockTool),
    list: vi.fn().mockReturnValue([mockTool]),
    toOpenAIFormat: vi.fn().mockReturnValue([])
  }

  const mockLLM: LLMClient = {
    complete: vi.fn().mockResolvedValue({
      toolCalls: [{
        toolCallId: 'call_1',
        toolName: 'editFile',
        arguments: {
          path: 'test.txt',
          oldString: 'Hello World',
          newString: 'Hello CoAuthor'
        }
      }],
      stopReason: 'tool_use'
    }),
    stream: vi.fn()
  }

  const mockContext: AgentContext = {
    llm: mockLLM,
    tools: mockTools,
    baseDir: '/tmp',
    conversationHistory: [],
    toolResults: new Map(),
    persistMessage: vi.fn()
  }

  it('should generate Diff for editFile in interaction request', async () => {
    const generator = agent.run(mockTask, mockContext)
    
    // 1. Verbose yield (Calling LLM...)
    let result = await generator.next()
    expect(result.value).toMatchObject({ kind: 'verbose' })

    // 2. Interaction yield (Confirm)
    result = await generator.next()
    
    expect(result.value).toMatchObject({
      kind: 'interaction',
      request: {
        kind: 'Confirm',
        purpose: 'confirm_risky_action',
        display: {
          contentKind: 'Diff'
        }
      }
    })

    const request = (result.value as any).request
    expect(request.display.description).toContain('edit file: test.txt')
    expect(request.display.content).toContain('--- test.txt')
    expect(request.display.content).toContain('+++ test.txt')
    expect(request.display.content).toContain('-Hello World')
    expect(request.display.content).toContain('+Hello CoAuthor')
  })
})
