// Task service: encapsulates task use cases (create, list, etc.)
// Adapters should call services, not EventStore directly

import { nanoid } from 'nanoid'
import type { EventStore, StoredEvent, TaskPriority, ArtifactRef } from '../domain/index.js'
import { DEFAULT_USER_ACTOR_ID } from '../domain/actor.js'
import { runProjection } from './projector.js'

// ============================================================================
// Projection Types
// ============================================================================

/**
 * TaskView - Read model for fast task queries.
 * Projected from DomainEvents via reducer.
 */
export type TaskView = {
  taskId: string
  title: string
  intent: string
  createdBy: string
  agentId: string                 // V0: 创建时直接指定的处理 Agent
  priority: TaskPriority
  status: 'open' | 'in_progress' | 'awaiting_user' | 'done' | 'failed' | 'canceled'
  artifactRefs?: ArtifactRef[]
  
  // UIP 交互状态
  pendingInteractionId?: string   // 当前等待响应的交互 ID
  lastInteractionId?: string      // 最后一次交互的 ID
  
  // V1 预留：子任务支持
  parentTaskId?: string
  childTaskIds?: string[]
  
  createdAt: string
  updatedAt: string               // 最后事件时间
}

export type TasksProjectionState = {
  tasks: TaskView[]
}

// ============================================================================
// Task Service
// ============================================================================

export type CreateTaskOptions = {
  title: string
  intent?: string
  priority?: TaskPriority
  artifactRefs?: ArtifactRef[]
  agentId: string
}

export class TaskService {
  readonly #store: EventStore
  readonly #currentActorId: string

  constructor(store: EventStore, currentActorId: string = DEFAULT_USER_ACTOR_ID) {
    this.#store = store
    this.#currentActorId = currentActorId
  }

  // Create new task event
  createTask(opts: CreateTaskOptions): { taskId: string } {
    const taskId = nanoid()
    this.#store.append(taskId, [
      {
        type: 'TaskCreated',
        payload: {
          taskId,
          title: opts.title,
          intent: opts.intent ?? '',
          priority: opts.priority ?? 'foreground',
          artifactRefs: opts.artifactRefs,
          agentId: opts.agentId,
          authorActorId: this.#currentActorId
        }
      }
    ])
    return { taskId }
  }

  // Build tasks projection from events
  listTasks(): TasksProjectionState {
    return runProjection<TasksProjectionState>({
      store: this.#store,
      name: 'tasks',
      defaultState: { tasks: [] },
      reduce: (state, event) => this.#reduceTasksProjection(state, event)
    })
  }

  // Get task by ID from projection
  getTask(taskId: string): TaskView | null {
    const state = this.listTasks()
    return state.tasks.find(t => t.taskId === taskId) ?? null
  }

  /**
   * Cancel a task.
   */
  cancelTask(taskId: string, reason?: string): void {
    this.#store.append(taskId, [
      {
        type: 'TaskCanceled',
        payload: {
          taskId,
          reason,
          authorActorId: this.#currentActorId
        }
      }
    ])
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  #reduceTasksProjection(state: TasksProjectionState, event: StoredEvent): TasksProjectionState {
    const tasks = state.tasks

    const findTaskIndex = (taskId: string): number => tasks.findIndex((t) => t.taskId === taskId)

    switch (event.type) {
      case 'TaskCreated': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx !== -1) return state

        tasks.push({
          taskId: event.payload.taskId,
          title: event.payload.title,
          intent: event.payload.intent ?? '',
          createdBy: event.payload.authorActorId,
          agentId: event.payload.agentId,
          priority: event.payload.priority ?? 'foreground',
          status: 'open',
          artifactRefs: event.payload.artifactRefs,
          pendingInteractionId: undefined,
          lastInteractionId: undefined,
          parentTaskId: undefined,
          childTaskIds: undefined,
          createdAt: event.createdAt,
          updatedAt: event.createdAt
        })
        return state
      }
      case 'TaskStarted': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx === -1) return state
        const task = tasks[idx]!
        task.status = 'in_progress'
        task.updatedAt = event.createdAt
        return state
      }
      case 'UserInteractionRequested': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx === -1) return state
        const task = tasks[idx]!
        task.status = 'awaiting_user'
        task.pendingInteractionId = event.payload.interactionId
        task.lastInteractionId = event.payload.interactionId
        task.updatedAt = event.createdAt
        return state
      }
      case 'UserInteractionResponded': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx === -1) return state
        const task = tasks[idx]!
        // Only clear if this response is for the pending interaction
        if (task.pendingInteractionId === event.payload.interactionId) {
          task.status = 'in_progress'
          task.pendingInteractionId = undefined
        }
        task.lastInteractionId = event.payload.interactionId
        task.updatedAt = event.createdAt
        return state
      }
      case 'TaskCompleted': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx === -1) return state
        const task = tasks[idx]!
        task.status = 'done'
        task.pendingInteractionId = undefined
        task.updatedAt = event.createdAt
        return state
      }
      case 'TaskFailed': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx === -1) return state
        const task = tasks[idx]!
        task.status = 'failed'
        task.pendingInteractionId = undefined
        task.updatedAt = event.createdAt
        return state
      }
      case 'TaskCanceled': {
        const idx = findTaskIndex(event.payload.taskId)
        if (idx === -1) return state
        const task = tasks[idx]!
        task.status = 'canceled'
        task.pendingInteractionId = undefined
        task.updatedAt = event.createdAt
        return state
      }
      default:
        return state
    }
  }
}
