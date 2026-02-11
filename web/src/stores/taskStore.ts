/**
 * Task store — client-side projection of tasks from events.
 *
 * Subscribes to eventBus for real-time updates (decoupled from connectionStore).
 */

import { create } from 'zustand'
import type { TaskView, StoredEvent } from '@/types'
import { api } from '@/services/api'
import { eventBus } from './eventBus'
import {
  TaskCreatedPayload, TaskIdPayload, TaskCompletedPayload,
  TaskFailedPayload, TaskCanceledPayload,
  InteractionRequestedPayload, InteractionRespondedPayload,
  safeParse,
} from '@/schemas/eventPayloads'

interface TaskState {
  tasks: TaskView[]
  loading: boolean
  error: string | null

  /** Initial fetch from HTTP */
  fetchTasks: () => Promise<void>

  /** Fetch a single task from HTTP and add to store */
  fetchTask: (taskId: string) => Promise<TaskView | null>

  /** Apply a real-time StoredEvent to update local state */
  applyEvent: (event: StoredEvent) => void
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  loading: false,
  error: null,

  fetchTasks: async () => {
    set({ loading: true, error: null })
    try {
      const tasks = await api.listTasks()
      set({ tasks, loading: false })
    } catch (e) {
      set({ error: (e as Error).message, loading: false })
    }
  },

  fetchTask: async (taskId: string) => {
    try {
      const task = await api.getTask(taskId)
      if (task) {
        const { tasks } = get()
        const idx = tasks.findIndex(t => t.taskId === taskId)
        if (idx >= 0) {
          set({ tasks: tasks.map((t, i) => i === idx ? task : t) })
        } else {
          set({ tasks: [...tasks, task] })
        }
        return task
      }
      return null
    } catch {
      return null
    }
  },

  applyEvent: (event) => {
    // Helper: update a single task field-set by taskId (functional set to avoid race conditions — B11)
    const updateTask = (taskId: string, patch: Partial<TaskView>) =>
      set(state => ({
        tasks: state.tasks.map(t => t.taskId === taskId ? { ...t, ...patch, updatedAt: event.createdAt } : t),
      }))

    switch (event.type) {
      case 'TaskCreated': {
        const p = safeParse(TaskCreatedPayload, event.payload, event.type)
        if (!p) return
        const newTask: TaskView = {
          taskId: p.taskId,
          title: p.title,
          intent: p.intent ?? '',
          createdBy: p.authorActorId,
          agentId: p.agentId,
          priority: p.priority ?? 'foreground',
          status: 'open',
          parentTaskId: p.parentTaskId,
          createdAt: event.createdAt,
          updatedAt: event.createdAt,
        }
        // Upsert: update if exists, add if new (functional set — B11)
        set(state => {
          const idx = state.tasks.findIndex(t => t.taskId === newTask.taskId)
          if (idx >= 0) {
            return { tasks: state.tasks.map((t, i) => i === idx ? { ...t, ...newTask } : t) }
          }
          return { tasks: [...state.tasks, newTask] }
        })
        break
      }
      case 'TaskStarted':
      case 'TaskPaused':
      case 'TaskResumed': {
        const p = safeParse(TaskIdPayload, event.payload, event.type)
        if (!p) return
        const statusMap = { TaskStarted: 'in_progress', TaskPaused: 'paused', TaskResumed: 'in_progress' } as const
        updateTask(p.taskId, { status: statusMap[event.type] })
        break
      }
      case 'TaskCompleted': {
        const p = safeParse(TaskCompletedPayload, event.payload, event.type)
        if (!p) return
        updateTask(p.taskId, { status: 'done', summary: p.summary })
        break
      }
      case 'TaskFailed': {
        const p = safeParse(TaskFailedPayload, event.payload, event.type)
        if (!p) return
        updateTask(p.taskId, { status: 'failed', failureReason: p.reason })
        break
      }
      case 'TaskCanceled': {
        const p = safeParse(TaskCanceledPayload, event.payload, event.type)
        if (!p) return
        updateTask(p.taskId, { status: 'canceled' })
        break
      }
      case 'UserInteractionRequested': {
        const p = safeParse(InteractionRequestedPayload, event.payload, event.type)
        if (!p) return
        updateTask(p.taskId, { status: 'awaiting_user', pendingInteractionId: p.interactionId })
        break
      }
      case 'UserInteractionResponded': {
        const p = safeParse(InteractionRespondedPayload, event.payload, event.type)
        if (!p) return
        updateTask(p.taskId, { status: 'in_progress', pendingInteractionId: undefined })
        break
      }
    }
  },
}))

// Subscribe to eventBus — decoupled from connectionStore
eventBus.on('domain-event', (event) => {
  useTaskStore.getState().applyEvent(event)
})