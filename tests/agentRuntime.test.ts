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
import { DefaultCoAuthorAgent } from '../src/agents/defaultAgent.js'
import { FakeLLMClient } from '../src/infra/fakeLLMClient.js'
import { DefaultToolRegistry } from '../src/infra/toolRegistry.js'
import { DefaultToolExecutor } from '../src/infra/toolExecutor.js'
import { DEFAULT_AGENT_ACTOR_ID, DEFAULT_USER_ACTOR_ID } from '../src/domain/actor.js'

/**
 * Helper to create test infrastructure in a temp directory.
 */
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
    taskService,
    interactionService,
    agent,
    llm,
    toolRegistry,
    toolExecutor,
    baseDir: dir
  })

  return { store, conversationStore, taskService, interactionService, runtime, llm, agent }
}

describe('AgentRuntime', () => {
  test('executeTask writes TaskStarted and UserInteractionRequested for confirmation', async () => {
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

    // Verify UserInteractionRequested was emitted (for task confirmation)
    const uipEvt = events.find((e) => e.type === 'UserInteractionRequested')
    expect(uipEvt).toBeTruthy()
    if (uipEvt?.type === 'UserInteractionRequested') {
      expect(uipEvt.payload.kind).toBe('Confirm')
      expect(uipEvt.payload.purpose).toBe('confirm_task')
    }

    // Task should now be awaiting user
    const view = taskService.getTask('t1')
    expect(view?.status).toBe('awaiting_user')
    expect(view?.agentId).toBe(DEFAULT_AGENT_ACTOR_ID)

    rmSync(dir, { recursive: true, force: true })
  })

  test('start polls TaskCreated and requests confirmation for assigned tasks', async () => {
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
    expect(events.some((e) => e.type === 'UserInteractionRequested')).toBe(true)

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
  test('conversation history is persisted after user confirms task', async () => {
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

    // At this point, task is awaiting user confirmation
    // No conversation should be persisted yet (just UIP event)
    let messages = conversationStore.getMessages('t1')
    expect(messages).toHaveLength(0)

    // Simulate user confirming the task
    const uipEvent = store.readStream('t1').find(e => e.type === 'UserInteractionRequested')
    expect(uipEvent?.type).toBe('UserInteractionRequested')
    
    if (uipEvent?.type === 'UserInteractionRequested') {
      store.append('t1', [
        {
          type: 'UserInteractionResponded',
          payload: {
            interactionId: uipEvent.payload.interactionId,
            taskId: 't1',
            selectedOptionId: 'proceed',
            authorActorId: DEFAULT_USER_ACTOR_ID
          }
        }
      ])
    }

    await vi.advanceTimersByTimeAsync(100)
    runtime.stop()
    vi.useRealTimers()

    // After confirmation, conversation should have system + user prompts
    messages = conversationStore.getMessages('t1')
    expect(messages.length).toBeGreaterThanOrEqual(2)
    expect(messages[0]?.role).toBe('system')
    expect(messages[1]?.role).toBe('user')

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
