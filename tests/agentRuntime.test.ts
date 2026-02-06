import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { JsonlEventStore } from '../src/infra/jsonlEventStore.js'
import { JsonlAuditLog } from '../src/infra/jsonlAuditLog.js'
import { JsonlConversationStore } from '../src/infra/jsonlConversationStore.js'
import { TaskService } from '../src/application/taskService.js'
import { InteractionService } from '../src/application/interactionService.js'
import { ContextBuilder } from '../src/application/contextBuilder.js'
import { AgentRuntime } from '../src/agents/runtime.js'
import { ConversationManager } from '../src/agents/conversationManager.js'
import { OutputHandler } from '../src/agents/outputHandler.js'
import { DefaultCoAuthorAgent } from '../src/agents/defaultAgent.js'
import { FakeLLMClient } from '../src/infra/fakeLLMClient.js'
import { DefaultToolRegistry } from '../src/infra/toolRegistry.js'
import { DefaultToolExecutor } from '../src/infra/toolExecutor.js'
import { DEFAULT_AGENT_ACTOR_ID, DEFAULT_USER_ACTOR_ID } from '../src/domain/actor.js'
import type { LLMClient, LLMResponse } from '../src/domain/ports/llmClient.js'
import type { ToolCallRequest, ToolResult, ToolExecutor } from '../src/domain/ports/tool.js'

import type { ArtifactStore } from '../src/domain/ports/artifactStore.js'

/**
 * Helper to create test infrastructure in a temp directory.
 */
function createTestInfra(dir: string, opts?: { llm?: LLMClient, toolExecutor?: ToolExecutor }) {
  const store = new JsonlEventStore({
    eventsPath: join(dir, 'events.jsonl'),
    projectionsPath: join(dir, 'projections.jsonl')
  })
  store.ensureSchema()

  const conversationStore = new JsonlConversationStore({
    conversationsPath: join(dir, 'conversations.jsonl')
  })
  conversationStore.ensureSchema()
  
  const artifactStore: ArtifactStore = {
    readFile: async () => '',
    readFileRange: async () => '',
    listDir: async () => [],
    writeFile: async () => {}
  }

  const auditLog = new JsonlAuditLog({ auditPath: join(dir, 'audit.jsonl') })
  const toolRegistry = new DefaultToolRegistry()
  
  // Register a dummy tool for testing
  toolRegistry.register({
    name: 'dummy_tool',
    description: 'A dummy tool',
    parameters: { type: 'object', properties: {} },
    riskLevel: 'safe',
    execute: async () => ({ toolCallId: 'placeholder', isError: false, output: 'dummy' })
  })

  const toolExecutor = opts?.toolExecutor ?? new DefaultToolExecutor({ registry: toolRegistry, auditLog })
  const taskService = new TaskService(store, DEFAULT_USER_ACTOR_ID)
  const interactionService = new InteractionService(store, DEFAULT_USER_ACTOR_ID)
  const contextBuilder = new ContextBuilder(dir)
  const llm = opts?.llm ?? new FakeLLMClient()
  const agent = new DefaultCoAuthorAgent({ contextBuilder })

  const conversationManager = new ConversationManager({
    conversationStore,
    auditLog,
    toolRegistry,
    toolExecutor,
    artifactStore
  })

  const outputHandler = new OutputHandler({
    toolExecutor,
    toolRegistry,
    artifactStore,
    conversationManager
  })

  const runtime = new AgentRuntime({
    store,
    taskService,
    agent,
    llm,
    toolRegistry,
    baseDir: dir,
    conversationManager,
    outputHandler
  })

  return { store, conversationStore, taskService, interactionService, runtime, llm, agent, toolRegistry }
}

describe('AgentRuntime', () => {
  test('executeTask writes TaskStarted and completes without confirm_task', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const { store, taskService, runtime } = createTestInfra(dir)

    store.append('t1', [
      {
        type: 'TaskCreated',
        payload: {
          taskId: 't1',
          title: 'T1',
          intent: 'test intent',
          priority: 'foreground',
          agentId: DEFAULT_AGENT_ACTOR_ID,
          authorActorId: DEFAULT_USER_ACTOR_ID
        }
      }
    ])

    const res = await runtime.executeTask('t1')
    expect(res.taskId).toBe('t1')

    const events = store.readStream('t1', 1)

    // Verify TaskStarted was emitted
    const startedEvt = events.find((e) => e.type === 'TaskStarted')
    expect(startedEvt).toBeTruthy()
    if (startedEvt?.type === 'TaskStarted') {
      expect(startedEvt.payload.agentId).toBe(DEFAULT_AGENT_ACTOR_ID)
    }

    // Should not emit confirm_task interaction
    expect(events.some((e) => e.type === 'UserInteractionRequested')).toBe(false)

    // Verify TaskCompleted was emitted
    expect(events.some((e) => e.type === 'TaskCompleted')).toBe(true)

    // Task should be done
    const view = taskService.getTask('t1')
    expect(view?.status).toBe('done')
    expect(view?.agentId).toBe(DEFAULT_AGENT_ACTOR_ID)

    rmSync(dir, { recursive: true, force: true })
  })

  test('start executes assigned tasks without confirm_task', async () => {
    vi.useFakeTimers()

    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const { store, runtime } = createTestInfra(dir)

    runtime.start()

    // Create a task assigned to this agent
    store.append('t2', [
      {
        type: 'TaskCreated',
        payload: {
          taskId: 't2',
          title: 'T2',
          intent: '',
          priority: 'foreground',
          agentId: DEFAULT_AGENT_ACTOR_ID,
          authorActorId: DEFAULT_USER_ACTOR_ID
        }
      }
    ])

    await vi.advanceTimersByTimeAsync(50)
    runtime.stop()
    vi.useRealTimers()

    const events = store.readStream('t2', 1)
    expect(events.some((e) => e.type === 'TaskStarted')).toBe(true)
    expect(events.some((e) => e.type === 'TaskCompleted')).toBe(true)
    expect(events.some((e) => e.type === 'UserInteractionRequested')).toBe(false)

    rmSync(dir, { recursive: true, force: true })
  })

  test('queues instruction added while task is running and re-executes after completion', async () => {
    vi.useFakeTimers()

    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))

    const baseLLM = new FakeLLMClient()
    const delayedLLM: LLMClient = {
      async complete(options) {
        await new Promise<void>((resolve) => setTimeout(resolve, 50))
        return baseLLM.complete(options)
      },
      stream(options) {
        return baseLLM.stream(options)
      }
    }

    const { store, taskService, runtime } = createTestInfra(dir, { llm: delayedLLM })

    runtime.start()

    const { taskId } = taskService.createTask({
      title: 'Queue Instruction',
      agentId: DEFAULT_AGENT_ACTOR_ID
    })

    await vi.advanceTimersByTimeAsync(1)

    taskService.addInstruction(taskId, 'Please apply this while running')

    await vi.advanceTimersByTimeAsync(200)
    runtime.stop()
    vi.useRealTimers()

    const completedCount = store.readStream(taskId).filter((e) => e.type === 'TaskCompleted').length
    expect(completedCount).toBe(2)

    rmSync(dir, { recursive: true, force: true })
  })

  test('ignores tasks assigned to other agents', async () => {
    vi.useFakeTimers()

    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const { store, runtime } = createTestInfra(dir)

    runtime.start()

    // Create a task assigned to a DIFFERENT agent
    store.append('t3', [
      {
        type: 'TaskCreated',
        payload: {
          taskId: 't3',
          title: 'T3',
          intent: '',
          priority: 'foreground',
          agentId: 'other_agent_id',
          authorActorId: DEFAULT_USER_ACTOR_ID
        }
      }
    ])

    await vi.advanceTimersByTimeAsync(50)
    runtime.stop()
    vi.useRealTimers()

    const events = store.readStream('t3', 1)
    // Should only have TaskCreated, no TaskStarted from our agent
    expect(events.length).toBe(1)
    expect(events[0]?.type).toBe('TaskCreated')

    rmSync(dir, { recursive: true, force: true })
  })
})

describe('AgentRuntime - Conversation Persistence', () => {
  test('conversation history is persisted during automatic task execution', async () => {
    vi.useFakeTimers()
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const { store, conversationStore, runtime } = createTestInfra(dir)

    // Start runtime first (to subscribe to events)
    runtime.start()

    // Then create task (triggers event handler)
    store.append('t1', [
      {
        type: 'TaskCreated',
        payload: {
          taskId: 't1',
          title: 'Test Task',
          intent: 'Do something',
          priority: 'foreground',
          agentId: DEFAULT_AGENT_ACTOR_ID,
          authorActorId: DEFAULT_USER_ACTOR_ID
        }
      }
    ])

    await vi.advanceTimersByTimeAsync(50)

    await vi.advanceTimersByTimeAsync(100)
    runtime.stop()
    vi.useRealTimers()

    // Conversation should have system + user prompts and at least one assistant message
    const messages = conversationStore.getMessages('t1')
    expect(messages.length).toBeGreaterThanOrEqual(3)
    expect(messages[0]?.role).toBe('system')
    expect(messages[1]?.role).toBe('user')
    expect(messages.some((m) => m.role === 'assistant')).toBe(true)

    rmSync(dir, { recursive: true, force: true })
  })

  test('conversation history survives runtime re-instantiation', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    
    // First runtime instance
    const infra1 = createTestInfra(dir)
    
    // Pre-populate conversation history
    infra1.conversationStore.append('t1', { role: 'system', content: 'System prompt' })
    infra1.conversationStore.append('t1', { role: 'user', content: 'User task' })
    infra1.conversationStore.append('t1', { role: 'assistant', content: 'I will help' })

    // Create a new runtime instance (simulating app restart)
    const infra2 = createTestInfra(dir)
    
    // The new conversation store should load persisted messages
    const messages = infra2.conversationStore.getMessages('t1')
    expect(messages).toHaveLength(3)
    expect(messages[0]?.role).toBe('system')
    expect(messages[1]?.role).toBe('user')
    expect(messages[2]?.role).toBe('assistant')

    rmSync(dir, { recursive: true, force: true })
  })
})

describe('AgentRuntime - Concurrency & State Management', () => {
  test('pause waits for pending tool calls to complete', async () => {
    vi.useFakeTimers()
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    
    // 1. Mock LLM to return 2 tool calls
    const mockLLM: LLMClient = {
      complete: vi.fn().mockImplementationOnce(async () => {
        return {
          stopReason: 'tool_use',
          toolCalls: [
            { toolCallId: 'call_1', toolName: 'dummy_tool', arguments: {} },
            { toolCallId: 'call_2', toolName: 'dummy_tool', arguments: {} }
          ]
        } as LLMResponse
      }).mockImplementation(async () => {
         return { stopReason: 'end_turn', content: 'Done' }
      }),
      stream: vi.fn()
    }

    // 2. Mock ToolExecutor to be slow/controllable
    // We want to pause AFTER call_1 is started but BEFORE call_2 is finished (or started)
    // Actually runtime executes tools sequentially in the loop if yielded sequentially.
    // DefaultAgent yields them sequentially.
    // So: Yield Tool 1 -> Runtime Exec 1 -> Yield Tool 2 -> Runtime Exec 2.
    // We want to trigger pause during Tool 1 execution.
    // And verify that Tool 2 is ALSO executed because "safe point" is only after all calls.
    
    let toolExecCount = 0
    const mockToolExecutor: ToolExecutor = {
      execute: async (call) => {
        toolExecCount++
        await new Promise(resolve => setTimeout(resolve, 50))
        return { toolCallId: call.toolCallId, output: 'success', isError: false }
      }
    }

    const { conversationStore, taskService, runtime } = createTestInfra(dir, { 
      llm: mockLLM, 
      toolExecutor: mockToolExecutor 
    })

    runtime.start()

    // Start task
    const { taskId } = taskService.createTask({
      title: 'Concurrency Task',
      agentId: DEFAULT_AGENT_ACTOR_ID
    })

    // Advance to start execution
    await vi.advanceTimersByTimeAsync(10) 
    // LLM returned. Agent yields call_1. Runtime calls execute.
    // Executor is waiting 50ms.
    
    // Trigger Pause NOW (while tool 1 is running)
    taskService.pauseTask(taskId, 'User paused')

    // Advance time to finish tool 1 (50ms) and tool 2 (50ms)
    await vi.advanceTimersByTimeAsync(200)

    // Verify both tools executed
    expect(toolExecCount).toBe(2)
    
    // Verify task is paused (eventually)
    const task = taskService.getTask(taskId)
    expect(task?.status).toBe('paused')
    
    // Verify conversation history has results for BOTH calls
    const messages = conversationStore.getMessages(taskId)
    expect(messages.some(m => m.role === 'tool' && m.toolCallId === 'call_1')).toBe(true)
    expect(messages.some(m => m.role === 'tool' && m.toolCallId === 'call_2')).toBe(true)
    
    // Cleanup
    runtime.stop()
    vi.useRealTimers()
    rmSync(dir, { recursive: true, force: true })
  })

  test('instruction added during unsafe state is queued and injected later', async () => {
    vi.useFakeTimers()
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    
    const mockLLM: LLMClient = {
      complete: vi.fn().mockImplementationOnce(async () => {
        return {
          stopReason: 'tool_use',
          toolCalls: [
            { toolCallId: 'call_1', toolName: 'dummy_tool', arguments: {} }
          ]
        }
      }).mockImplementation(async () => {
         return { stopReason: 'end_turn', content: 'Done' }
      }),
      stream: vi.fn()
    }

    let resolveTool: ((value: unknown) => void) | null = null
    const mockToolExecutor: ToolExecutor = {
      execute: async (call) => {
        await new Promise(resolve => { resolveTool = resolve })
        return { toolCallId: call.toolCallId, output: 'success', isError: false }
      }
    }

    const { conversationStore, taskService, runtime } = createTestInfra(dir, { 
      llm: mockLLM, 
      toolExecutor: mockToolExecutor 
    })

    runtime.start()
    const { taskId } = taskService.createTask({ title: 'Queue', agentId: DEFAULT_AGENT_ACTOR_ID })
    
    await vi.advanceTimersByTimeAsync(10) // Start task, LLM returns, Tool starts waiting

    // Add instruction NOW (unsafe state: assistant has call, no result yet)
    taskService.addInstruction(taskId, 'Interrupted Instruction')
    
    // Verify NOT in history yet
    let messages = conversationStore.getMessages(taskId)
    const injectedMsg = messages.find(m => m.role === 'user' && m.content === 'Interrupted Instruction')
    expect(injectedMsg).toBeUndefined()

    // Finish tool execution
    if (resolveTool) (resolveTool as any)('done')
    await vi.advanceTimersByTimeAsync(100) // Allow runtime to process result and loop
    
    // Verify instruction IS now in history (after tool result)
    messages = conversationStore.getMessages(taskId)
    
    // Check sequence: Tool -> User (Instruction)
    const toolMsgIndex = messages.findIndex(m => m.role === 'tool' && m.toolCallId === 'call_1')
    const userMsgIndex = messages.findIndex(m => m.role === 'user' && m.content === 'Interrupted Instruction')
    
    expect(toolMsgIndex).toBeGreaterThan(-1)
    expect(userMsgIndex).toBeGreaterThan(-1)
    expect(userMsgIndex).toBeGreaterThan(toolMsgIndex)

    runtime.stop()
    vi.useRealTimers()
    rmSync(dir, { recursive: true, force: true })
  })

  test('auto-repairs dangling tool calls on resume', async () => {
    vi.useFakeTimers()
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const { conversationStore, runtime, taskService } = createTestInfra(dir)

    // 1. Manually create a broken history
    // Note: We need to ensure these messages are persisted before runtime loads them
    const { taskId: realTaskId } = taskService.createTask({ title: 'Broken', agentId: DEFAULT_AGENT_ACTOR_ID })
    
    conversationStore.append(realTaskId, { 
      role: 'assistant', 
      toolCalls: [{ toolCallId: 'call_x', toolName: 'risky_tool', arguments: {} }] 
    })
    
    // 2. Start runtime
    runtime.start()
    taskService.resumeTask(realTaskId)
    
    // 3. Allow processing
    await vi.advanceTimersByTimeAsync(100)
    
    // 4. Verify history is repaired
    const messages = conversationStore.getMessages(realTaskId)
    const toolMsg = messages.find(m => m.role === 'tool' && m.toolCallId === 'call_x')
    
    expect(toolMsg).toBeDefined()
    expect(toolMsg?.content).toContain('interrupted')

    runtime.stop()
    vi.useRealTimers()
    rmSync(dir, { recursive: true, force: true })
  })

  test('retries dangling safe tool calls on resume and persists result', async () => {
    vi.useFakeTimers()
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))

    const mockLLM: LLMClient = {
      complete: vi.fn().mockResolvedValue({ stopReason: 'end_turn', content: 'Done' }),
      stream: vi.fn()
    }

    const toolExec = vi.fn(async (call: ToolCallRequest) => {
      return { toolCallId: call.toolCallId, output: { repaired: true }, isError: false } as ToolResult
    })

    const mockToolExecutor: ToolExecutor = {
      execute: toolExec
    }

    const { conversationStore, runtime, taskService } = createTestInfra(dir, { llm: mockLLM, toolExecutor: mockToolExecutor })

    const { taskId } = taskService.createTask({ title: 'Safe Repair', agentId: DEFAULT_AGENT_ACTOR_ID })
    conversationStore.append(taskId, {
      role: 'assistant',
      toolCalls: [{ toolCallId: 'call_safe', toolName: 'dummy_tool', arguments: {} }]
    })

    runtime.start()
    taskService.resumeTask(taskId)
    await vi.advanceTimersByTimeAsync(100)

    expect(toolExec).toHaveBeenCalled()
    expect(conversationStore.getMessages(taskId).some(m => m.role === 'tool' && m.toolCallId === 'call_safe')).toBe(true)

    runtime.stop()
    vi.useRealTimers()
    rmSync(dir, { recursive: true, force: true })
  })

  test('does not inject interrupted error for dangling risky tools on resume', async () => {
    vi.useFakeTimers()
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const { conversationStore, runtime, taskService, toolRegistry } = createTestInfra(dir)
    
    // Register risky tool
    toolRegistry.register({
      name: 'risky_tool',
      description: 'Risky',
      parameters: { type: 'object', properties: {} },
      riskLevel: 'risky',
      execute: async () => ({ toolCallId: 'placeholder', isError: false, output: 'done' })
    })

    const { taskId } = taskService.createTask({ title: 'Risky Resume', agentId: DEFAULT_AGENT_ACTOR_ID })
    
    // Manually inject dangling risky tool call
    conversationStore.append(taskId, { 
      role: 'assistant', 
      toolCalls: [{ toolCallId: 'call_risky', toolName: 'risky_tool', arguments: {} }] 
    })
    
    runtime.start()
    
    // Trigger resume to force repair
    taskService.resumeTask(taskId)

    // Wait for repair
    await vi.advanceTimersByTimeAsync(100)
    
    // Verify NO tool message injected
    const messages = conversationStore.getMessages(taskId)
    const toolMsg = messages.find(m => m.role === 'tool' && m.toolCallId === 'call_risky')
    
    expect(toolMsg).toBeUndefined()

    runtime.stop()
    vi.useRealTimers()
    rmSync(dir, { recursive: true, force: true })
  })

  test('executes dangling risky tool call when approved', async () => {
    vi.useFakeTimers()
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))

    const toolExec = vi.fn(async (call: ToolCallRequest, ctx: any) => {
      return { toolCallId: call.toolCallId, output: { ok: true, confirmedInteractionId: ctx.confirmedInteractionId }, isError: false } as ToolResult
    })

    const mockToolExecutor: ToolExecutor = {
      execute: toolExec as any
    }

    const { conversationStore, runtime, taskService, interactionService, toolRegistry } = createTestInfra(dir, {
      toolExecutor: mockToolExecutor
    })

    toolRegistry.register({
      name: 'risky_tool_approve',
      description: 'Risky',
      parameters: { type: 'object', properties: {} },
      riskLevel: 'risky',
      execute: async () => ({ toolCallId: 'placeholder', isError: false, output: 'done' })
    })

    const { taskId } = taskService.createTask({ title: 'Risky Approve', agentId: DEFAULT_AGENT_ACTOR_ID })
    conversationStore.append(taskId, {
      role: 'assistant',
      toolCalls: [{ toolCallId: 'call_risky', toolName: 'risky_tool_approve', arguments: {} }]
    })

    runtime.start()
    interactionService.respondToInteraction(taskId, 'ui_test', { selectedOptionId: 'approve' })
    await vi.advanceTimersByTimeAsync(200)

    expect(toolExec).toHaveBeenCalledTimes(1)
    const messages = conversationStore.getMessages(taskId)
    const toolMsg = messages.find(m => m.role === 'tool' && m.toolCallId === 'call_risky')
    expect(toolMsg).toBeDefined()
    expect(toolMsg?.content).toContain('ok')
    expect(toolMsg?.content).not.toContain('interrupted')

    runtime.stop()
    vi.useRealTimers()
    rmSync(dir, { recursive: true, force: true })
  })

  test('writes rejection tool result when risky tool rejected', async () => {
    vi.useFakeTimers()
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))

    const toolExec = vi.fn(async () => {
      return { toolCallId: 'call_risky', output: { ok: true }, isError: false } as ToolResult
    })

    const mockToolExecutor: ToolExecutor = {
      execute: toolExec as any
    }

    const { conversationStore, runtime, taskService, interactionService, toolRegistry } = createTestInfra(dir, {
      toolExecutor: mockToolExecutor
    })

    toolRegistry.register({
      name: 'risky_tool_reject',
      description: 'Risky',
      parameters: { type: 'object', properties: {} },
      riskLevel: 'risky',
      execute: async () => ({ toolCallId: 'placeholder', isError: false, output: 'done' })
    })

    const { taskId } = taskService.createTask({ title: 'Risky Reject', agentId: DEFAULT_AGENT_ACTOR_ID })
    conversationStore.append(taskId, {
      role: 'assistant',
      toolCalls: [{ toolCallId: 'call_risky', toolName: 'risky_tool_reject', arguments: {} }]
    })

    runtime.start()
    interactionService.respondToInteraction(taskId, 'ui_test', { selectedOptionId: 'reject' })
    await vi.advanceTimersByTimeAsync(200)

    expect(toolExec).toHaveBeenCalledTimes(0)
    const messages = conversationStore.getMessages(taskId)
    const toolMsg = messages.find(m => m.role === 'tool' && m.toolCallId === 'call_risky')
    expect(toolMsg).toBeDefined()
    expect(toolMsg?.content).toContain('User rejected the request')

    runtime.stop()
    vi.useRealTimers()
    rmSync(dir, { recursive: true, force: true })
  })

  test('queues instruction while awaiting risky confirmation and injects after tool result', async () => {
    vi.useFakeTimers()
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))

    const mockLLM: LLMClient = {
      complete: vi
        .fn()
        .mockImplementationOnce(async () => {
          return {
            stopReason: 'tool_use',
            toolCalls: [{ toolCallId: 'call_risky', toolName: 'risky_tool_flow', arguments: {} }]
          } as LLMResponse
        })
        .mockImplementationOnce(async () => {
          return { stopReason: 'end_turn', content: 'Done' } as LLMResponse
        }),
      stream: vi.fn()
    }

    const toolExec = vi.fn(async (call: ToolCallRequest, ctx: any) => {
      return { toolCallId: call.toolCallId, output: { ok: true, confirmedInteractionId: ctx.confirmedInteractionId }, isError: false } as ToolResult
    })

    const mockToolExecutor: ToolExecutor = {
      execute: toolExec as any
    }

    const { store, conversationStore, runtime, taskService, interactionService, toolRegistry } = createTestInfra(dir, {
      llm: mockLLM,
      toolExecutor: mockToolExecutor
    })

    toolRegistry.register({
      name: 'risky_tool_flow',
      description: 'Risky',
      parameters: { type: 'object', properties: {} },
      riskLevel: 'risky',
      execute: async () => ({ toolCallId: 'placeholder', isError: false, output: 'done' })
    })

    runtime.start()
    const { taskId } = taskService.createTask({ title: 'Risky + Instruction', agentId: DEFAULT_AGENT_ACTOR_ID })

    await vi.advanceTimersByTimeAsync(50)

    const requested = store.readStream(taskId).find(e => e.type === 'UserInteractionRequested')
    expect(requested?.type).toBe('UserInteractionRequested')
    const interactionId = requested?.type === 'UserInteractionRequested' ? requested.payload.interactionId : ''
    expect(interactionId).toBeTruthy()

    taskService.addInstruction(taskId, 'Follow-up instruction')
    await vi.advanceTimersByTimeAsync(10)

    const before = conversationStore.getMessages(taskId)
    expect(before.some(m => m.role === 'user' && m.content === 'Follow-up instruction')).toBe(false)

    interactionService.respondToInteraction(taskId, interactionId, { selectedOptionId: 'approve' })
    await vi.advanceTimersByTimeAsync(200)

    const after = conversationStore.getMessages(taskId)
    const toolIndex = after.findIndex(m => m.role === 'tool' && m.toolCallId === 'call_risky')
    const instructionIndex = after.findIndex(m => m.role === 'user' && m.content === 'Follow-up instruction')
    expect(toolIndex).toBeGreaterThan(-1)
    expect(instructionIndex).toBeGreaterThan(-1)
    expect(instructionIndex).toBeGreaterThan(toolIndex)
    expect(after.some(m => m.role === 'tool' && typeof m.content === 'string' && m.content.includes('interrupted'))).toBe(false)

    runtime.stop()
    vi.useRealTimers()
    rmSync(dir, { recursive: true, force: true })
  })

  test('stress randomized pause/resume/instruction/interaction sequencing', async () => {
    vi.useFakeTimers()
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))

    let llmCalls = 0
    const mockLLM: LLMClient = {
      complete: vi.fn().mockImplementation(async () => {
        llmCalls += 1
        if (llmCalls === 1) {
          return {
            stopReason: 'tool_use',
            toolCalls: [{ toolCallId: 'call_risky', toolName: 'risky_tool_stress', arguments: {} }]
          } as LLMResponse
        }
        if (llmCalls === 2) {
          return {
            stopReason: 'tool_use',
            toolCalls: [{ toolCallId: 'call_safe', toolName: 'dummy_tool', arguments: {} }]
          } as LLMResponse
        }
        return { stopReason: 'end_turn', content: 'Done' } as LLMResponse
      }),
      stream: vi.fn()
    }

    const toolExec: ToolExecutor = {
      execute: async (call, ctx: any) => {
        await new Promise(resolve => setTimeout(resolve, 10))
        return { toolCallId: call.toolCallId, output: { ok: true, confirmedInteractionId: ctx.confirmedInteractionId }, isError: false } as ToolResult
      }
    }

    const { conversationStore, runtime, taskService, interactionService, toolRegistry } = createTestInfra(dir, {
      llm: mockLLM,
      toolExecutor: toolExec
    })

    toolRegistry.register({
      name: 'risky_tool_stress',
      description: 'Risky',
      parameters: { type: 'object', properties: {} },
      riskLevel: 'risky',
      execute: async () => ({ toolCallId: 'placeholder', isError: false, output: 'done' })
    })

    const { taskId } = taskService.createTask({ title: 'Stress', agentId: DEFAULT_AGENT_ACTOR_ID })
    runtime.start()

    let seed = 1729
    const rand = () => {
      seed = (seed * 1103515245 + 12345) % 2147483647
      return seed / 2147483647
    }

    for (let i = 0; i < 40; i += 1) {
      const pending = interactionService.getPendingInteraction(taskId)
      const r = rand()
      if (pending && r < 0.35) {
        const option = r < 0.18 ? 'approve' : 'reject'
        interactionService.respondToInteraction(taskId, pending.interactionId, { selectedOptionId: option })
      } else if (r < 0.55) {
        taskService.addInstruction(taskId, `instruction-${i}`)
      } else if (r < 0.7) {
        taskService.pauseTask(taskId, `pause-${i}`)
      } else if (r < 0.85) {
        taskService.resumeTask(taskId, `resume-${i}`)
      }
      await vi.advanceTimersByTimeAsync(30)
    }

    const pendingFinal = interactionService.getPendingInteraction(taskId)
    if (pendingFinal) {
      interactionService.respondToInteraction(taskId, pendingFinal.interactionId, { selectedOptionId: 'approve' })
    }
    taskService.resumeTask(taskId, 'final-resume')
    await vi.advanceTimersByTimeAsync(200)

    const messages = conversationStore.getMessages(taskId)
    const toolIds = new Set<string>()
    for (const message of messages) {
      if (message.role === 'assistant') {
        for (const call of message.toolCalls ?? []) {
          toolIds.add(call.toolCallId)
        }
      }
    }
    for (const toolId of toolIds) {
      expect(messages.some(m => m.role === 'tool' && m.toolCallId === toolId)).toBe(true)
    }
    expect(messages.some(m => m.role === 'tool' && typeof m.content === 'string' && m.content.includes('interrupted'))).toBe(false)

    runtime.stop()
    vi.useRealTimers()
    rmSync(dir, { recursive: true, force: true })
  })
})
