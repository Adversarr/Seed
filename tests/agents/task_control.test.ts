import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { JsonlEventStore } from '../../src/infra/jsonlEventStore.js'
import { JsonlAuditLog } from '../../src/infra/jsonlAuditLog.js'
import { JsonlConversationStore } from '../../src/infra/jsonlConversationStore.js'
import { TaskService } from '../../src/application/taskService.js'
import { InteractionService } from '../../src/application/interactionService.js'
import { ContextBuilder } from '../../src/application/contextBuilder.js'
import { AgentRuntime } from '../../src/agents/runtime.js'
import { DefaultCoAuthorAgent } from '../../src/agents/defaultAgent.js'
import { FakeLLMClient } from '../../src/infra/fakeLLMClient.js'
import { DefaultToolRegistry } from '../../src/infra/toolRegistry.js'
import { DefaultToolExecutor } from '../../src/infra/toolExecutor.js'
import { DEFAULT_AGENT_ACTOR_ID, DEFAULT_USER_ACTOR_ID } from '../../src/domain/actor.js'

function createTestInfra(dir: string) {
  const store = new JsonlEventStore({
    eventsPath: join(dir, 'events.jsonl'),
    projectionsPath: join(dir, 'projections.jsonl')
  })
  store.ensureSchema()

  const conversationStore = new JsonlConversationStore({
    conversationsPath: join(dir, 'conversations.jsonl')
  })
  conversationStore.ensureSchema()

  const auditLog = new JsonlAuditLog({ auditPath: join(dir, 'audit.jsonl') })
  const toolRegistry = new DefaultToolRegistry()
  const toolExecutor = new DefaultToolExecutor({ registry: toolRegistry, auditLog })
  const taskService = new TaskService(store, DEFAULT_USER_ACTOR_ID)
  const interactionService = new InteractionService(store, DEFAULT_USER_ACTOR_ID)
  const contextBuilder = new ContextBuilder(dir)
  const llm = new FakeLLMClient()
  const agent = new DefaultCoAuthorAgent({ contextBuilder })

  const runtime = new AgentRuntime({
    store,
    conversationStore,
    auditLog,
    taskService,
    interactionService,
    agent,
    llm,
    toolRegistry,
    toolExecutor,
    baseDir: dir
  })

  return { store, conversationStore, taskService, runtime, llm }
}

describe('Task Control & Session', () => {
  test('Pause and Resume updates status and triggers execution', async () => {
    vi.useFakeTimers()
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-control-'))
    const { store, taskService, runtime } = createTestInfra(dir)

    runtime.start()

    // 1. Create task
    const { taskId } = taskService.createTask({
      title: 'Control Task',
      agentId: DEFAULT_AGENT_ACTOR_ID
    })

    // 2. Pause task immediately
    taskService.pauseTask(taskId, 'Hold on')
    
    // Check status is paused
    let task = taskService.getTask(taskId)
    expect(task?.status).toBe('paused')

    // 3. Resume task
    taskService.resumeTask(taskId, 'Go')

    // Check status is in_progress
    task = taskService.getTask(taskId)
    expect(task?.status).toBe('in_progress')

    // Allow runtime to process events
    await vi.advanceTimersByTimeAsync(100)

    // Verify Agent ran (should have TaskCompleted)
    const events = store.readStream(taskId)
    expect(events.some(e => e.type === 'TaskCompleted')).toBe(true)

    runtime.stop()
    vi.useRealTimers()
    rmSync(dir, { recursive: true, force: true })
  })

  test('Add Instruction to Done task resumes it', async () => {
    vi.useFakeTimers()
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-session-'))
    const { store, conversationStore, taskService, runtime } = createTestInfra(dir)

    runtime.start()

    // 1. Create and finish task
    const { taskId } = taskService.createTask({
      title: 'Session Task',
      agentId: DEFAULT_AGENT_ACTOR_ID
    })

    await vi.advanceTimersByTimeAsync(100)
    
    let task = taskService.getTask(taskId)
    expect(task?.status).toBe('done')
    const completedCount1 = store.readStream(taskId).filter(e => e.type === 'TaskCompleted').length
    expect(completedCount1).toBe(1)

    // 2. Add Instruction
    const newInstruction = 'Please refine this'
    taskService.addInstruction(taskId, newInstruction)

    // Check status updated immediately to in_progress
    task = taskService.getTask(taskId)
    expect(task?.status).toBe('in_progress')

    // 3. Allow runtime to process
    await vi.advanceTimersByTimeAsync(100)

    // 4. Verify Agent ran again (TaskCompleted count increased)
    const events = store.readStream(taskId)
    const completedCount2 = events.filter(e => e.type === 'TaskCompleted').length
    expect(completedCount2).toBe(2)

    // 5. Verify conversation history has the instruction
    const messages = conversationStore.getMessages(taskId)
    const userMessages = messages.filter(m => m.role === 'user')
    // 1st: Initial intent (inserted by ContextBuilder? No, ContextBuilder puts it in System/User prompt).
    // Actually, DefaultAgent puts task intent in the prompt.
    // But conversationStore tracks messages persisted *during* the run.
    // The *new* instruction is explicitly appended to conversationStore by runtime.
    // So we should see it.
    const instructionMsg = userMessages.find(m => m.content === newInstruction)
    expect(instructionMsg).toBeDefined()

    runtime.stop()
    vi.useRealTimers()
    rmSync(dir, { recursive: true, force: true })
  })
})
