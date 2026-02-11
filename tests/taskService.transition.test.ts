
import { describe, expect, test } from 'vitest'
import { TaskService } from '../src/application/services/taskService.js'
import { DEFAULT_AGENT_ACTOR_ID, DEFAULT_USER_ACTOR_ID } from '../src/core/entities/actor.js'
import { EventStore, DomainEvent, StoredEvent } from '../src/core/index.js'
import { Subject } from 'rxjs'

// Simple InMemory EventStore for testing
class InMemoryEventStore implements EventStore {
  private events: StoredEvent[] = []
  public events$ = new Subject<StoredEvent>()

  async ensureSchema(): Promise<void> {}
  
  async append(streamId: string, events: DomainEvent[]): Promise<StoredEvent[]> {
    const currentStreamEvents = this.events.filter(ev => ev.streamId === streamId)
    const newStoredEvents = events.map((e, i) => ({
      id: this.events.length + i + 1,
      streamId,
      seq: currentStreamEvents.length + i + 1,
      ...e,
      createdAt: new Date().toISOString()
    })) as StoredEvent[]
    this.events.push(...newStoredEvents)
    newStoredEvents.forEach(e => this.events$.next(e))
    return newStoredEvents
  }
  
  async readStream(streamId: string): Promise<StoredEvent[]> {
    return this.events.filter(e => e.streamId === streamId)
  }

  async readAll(fromIdExclusive?: number): Promise<StoredEvent[]> {
     const startId = fromIdExclusive ?? 0
     return this.events.filter(e => e.id > startId)
  }

  async readById(id: number): Promise<StoredEvent | null> {
      return this.events.find(e => e.id === id) || null
  }
  
  async getProjection<TState>(name: string, defaultState: TState): Promise<{ cursorEventId: number, state: TState }> {
    return { cursorEventId: 0, state: defaultState }
  }

  async saveProjection(): Promise<void> {}
}

describe('TaskService State Transitions', () => {
  const setup = () => {
    const store = new InMemoryEventStore()
    const service = new TaskService(store, DEFAULT_USER_ACTOR_ID)
    return { store, service }
  }

  const createTask = async (store: InMemoryEventStore, taskId: string) => {
    await store.append(taskId, [{
      type: 'TaskCreated',
      payload: { taskId, title: 'Test Task', intent: 'test', priority: 'normal', agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_USER_ACTOR_ID }
    }])
  }

  test('allows valid transitions', async () => {
    const { store, service } = setup()
    const taskId = 't1'
    await createTask(store, taskId)

    // open -> in_progress (TaskStarted)
    await store.append(taskId, [{
      type: 'TaskStarted',
      payload: { taskId, agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_AGENT_ACTOR_ID }
    }])
    expect((await service.getTask(taskId))?.status).toBe('in_progress')

    // in_progress -> awaiting_user (UserInteractionRequested)
    await store.append(taskId, [{
      type: 'UserInteractionRequested',
      payload: { 
        taskId, 
        interactionId: 'i1', 
        kind: 'Confirm', 
        purpose: 'generic', 
        display: { title: 'confirm?' }, 
        options: [], 
        validation: {}, 
        authorActorId: DEFAULT_AGENT_ACTOR_ID 
      }
    }])
    expect((await service.getTask(taskId))?.status).toBe('awaiting_user')

    // awaiting_user -> in_progress (UserInteractionResponded)
    await store.append(taskId, [{
      type: 'UserInteractionResponded',
      payload: { taskId, interactionId: 'i1', selectedOptionId: 'ok', authorActorId: DEFAULT_USER_ACTOR_ID }
    }])
    expect((await service.getTask(taskId))?.status).toBe('in_progress')

    // in_progress -> done (TaskCompleted)
    await store.append(taskId, [{
      type: 'TaskCompleted',
      payload: { taskId, summary: 'done', authorActorId: DEFAULT_AGENT_ACTOR_ID }
    }])
    expect((await service.getTask(taskId))?.status).toBe('done')

    // done -> in_progress (TaskInstructionAdded - Re-activation)
    await store.append(taskId, [{
      type: 'TaskInstructionAdded',
      payload: { taskId, instruction: 'more work', authorActorId: DEFAULT_USER_ACTOR_ID }
    }])
    expect((await service.getTask(taskId))?.status).toBe('in_progress')
  })

  test('prevents invalid transitions', async () => {
    const { store, service } = setup()
    const taskId = 't2'
    await createTask(store, taskId)

    // Move to canceled
    await store.append(taskId, [{
        type: 'TaskStarted',
        payload: { taskId, agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_AGENT_ACTOR_ID }
    }])
    await store.append(taskId, [{
      type: 'TaskCanceled',
      payload: { taskId, reason: 'cancel', authorActorId: DEFAULT_USER_ACTOR_ID }
    }])
    expect((await service.getTask(taskId))?.status).toBe('canceled')

    // canceled -> in_progress (TaskResumed) - Should Fail/Ignore
    await store.append(taskId, [{
      type: 'TaskResumed',
      payload: { taskId, authorActorId: DEFAULT_USER_ACTOR_ID }
    }])
    // Should stay canceled
    expect((await service.getTask(taskId))?.status).toBe('canceled') 
  })

  test('prevents bypassing interaction response', async () => {
    const { store, service } = setup()
    const taskId = 't3'
    await createTask(store, taskId)

    // Move to awaiting_user
    await store.append(taskId, [{
        type: 'TaskStarted',
        payload: { taskId, agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_AGENT_ACTOR_ID }
    }])
    await store.append(taskId, [{
      type: 'UserInteractionRequested',
      payload: { 
        taskId, 
        interactionId: 'i2', 
        kind: 'Confirm', 
        purpose: 'generic', 
        display: { title: 'confirm?' }, 
        options: [], 
        validation: {}, 
        authorActorId: DEFAULT_AGENT_ACTOR_ID 
      }
    }])
    expect((await service.getTask(taskId))?.status).toBe('awaiting_user')

    // awaiting_user -> in_progress (TaskResumed) - Should Fail/Ignore
    // User should respond, not just resume
    await store.append(taskId, [{
      type: 'TaskResumed',
      payload: { taskId, authorActorId: DEFAULT_USER_ACTOR_ID }
    }])
    expect((await service.getTask(taskId))?.status).toBe('awaiting_user')
  })
  
  test('TaskInstructionAdded overrides awaiting_user', async () => {
      const { store, service } = setup()
      const taskId = 't4'
      await createTask(store, taskId)
  
      // Move to awaiting_user
      await store.append(taskId, [{
          type: 'TaskStarted',
          payload: { taskId, agentId: DEFAULT_AGENT_ACTOR_ID, authorActorId: DEFAULT_AGENT_ACTOR_ID }
      }])
      await store.append(taskId, [{
        type: 'UserInteractionRequested',
        payload: { 
            taskId, 
            interactionId: 'i3', 
            kind: 'Confirm', 
            purpose: 'generic', 
            display: { title: 'confirm?' }, 
            options: [], 
            validation: {}, 
            authorActorId: DEFAULT_AGENT_ACTOR_ID 
        }
      }])
      
      // awaiting_user stays awaiting_user on instruction (CC-004 fix:
      // instruction should not silently override pending UIP)
      await store.append(taskId, [{
        type: 'TaskInstructionAdded',
        payload: { taskId, instruction: 'nevermind do this', authorActorId: DEFAULT_USER_ACTOR_ID }
      }])
      expect((await service.getTask(taskId))?.status).toBe('awaiting_user')
  })
})

describe('TaskService Command Validation', () => {
  const setup = () => {
    const store = new InMemoryEventStore()
    const service = new TaskService(store, DEFAULT_USER_ACTOR_ID)
    return { store, service }
  }

  const createTask = async (service: TaskService) => {
    return (await service.createTask({
      title: 'Test Task',
      agentId: DEFAULT_AGENT_ACTOR_ID
    })).taskId
  }

  test('throws when cancelling a task that cannot be canceled', async () => {
    const { store, service } = setup()
    const taskId = await createTask(service)

    // open -> canceled (Valid)
    await service.cancelTask(taskId)
    expect((await service.getTask(taskId))?.status).toBe('canceled')

    // canceled -> canceled (Invalid? Actually TaskCanceled is not in allowed transitions for canceled)
    // canTransition('canceled', 'TaskCanceled') -> false
    await expect(service.cancelTask(taskId)).rejects.toThrow(/Invalid transition/)
  })

  test('throws when pausing a task that is not in progress', async () => {
    const { store, service } = setup()
    const taskId = await createTask(service)

    // open -> paused (Invalid, must be in_progress?)
    // canTransition('open', 'TaskPaused') -> false
    await expect(service.pauseTask(taskId)).rejects.toThrow(/Invalid transition/)
  })

  test('throws when resuming a task that is not paused', async () => {
    const { store, service } = setup()
    const taskId = await createTask(service)

    // open -> resumed (Invalid)
    await expect(service.resumeTask(taskId)).rejects.toThrow(/Invalid transition/)
  })

  test('throws when adding instruction to canceled task (CC-004)', async () => {
    const { store, service } = setup()
    const taskId = await createTask(service)
    
    // TaskInstructionAdded moves open → in_progress
    await service.addInstruction(taskId, 'inst')
    expect((await service.getTask(taskId))?.status).toBe('in_progress')

    await service.cancelTask(taskId)
    expect((await service.getTask(taskId))?.status).toBe('canceled')
    
    // canceled → instruction now throws (CC-004: paused/canceled block instructions)
    await expect(service.addInstruction(taskId, 'wake up')).rejects.toThrow(/Invalid transition/)
  })
})
