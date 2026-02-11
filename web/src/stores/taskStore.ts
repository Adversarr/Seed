/**
 * Task store — client-side projection of tasks from events.
 *
 * Subscribes to eventBus for real-time updates (decoupled from connectionStore).
 */

import { create } from 'zustand'
import type { TaskView, StoredEvent } from '@/types'
import { api } from '@/services/api'
import { eventBus } from './eventBus'

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
    const { tasks } = get()
    const p = event.payload as Record<string, unknown>

    switch (event.type) {
      case 'TaskCreated': {
        // Upsert: update if exists, add if new
        const idx = tasks.findIndex(t => t.taskId === p.taskId)
        const newTask: TaskView = {
          taskId: p.taskId as string,
          title: p.title as string,
          intent: (p.intent as string | undefined) ?? '',
          createdBy: p.authorActorId as string,
          agentId: p.agentId as string,
          priority: (p.priority as TaskView['priority']) ?? 'foreground',
          status: 'open',
          parentTaskId: p.parentTaskId as string | undefined,
          createdAt: event.createdAt,
          updatedAt: event.createdAt,
        }
        if (idx >= 0) {
          set({ tasks: tasks.map((t, i) => i === idx ? { ...t, ...newTask } : t) })
        } else {
          set({ tasks: [...tasks, newTask] })
        }
        break
      }
      case 'TaskStarted':
        set({ tasks: tasks.map(t => t.taskId === p.taskId ? { ...t, status: 'in_progress' as const, updatedAt: event.createdAt } : t) })
        break
      case 'TaskCompleted':
        set({ tasks: tasks.map(t => t.taskId === p.taskId ? { ...t, status: 'done' as const, summary: p.summary as string | undefined, updatedAt: event.createdAt } : t) })
        break
      case 'TaskFailed':
        set({ tasks: tasks.map(t => t.taskId === p.taskId ? { ...t, status: 'failed' as const, failureReason: p.reason as string, updatedAt: event.createdAt } : t) })
        break
      case 'TaskCanceled':
        set({ tasks: tasks.map(t => t.taskId === p.taskId ? { ...t, status: 'canceled' as const, updatedAt: event.createdAt } : t) })
        break
      case 'TaskPaused':
        set({ tasks: tasks.map(t => t.taskId === p.taskId ? { ...t, status: 'paused' as const, updatedAt: event.createdAt } : t) })
        break
      case 'TaskResumed':
        set({ tasks: tasks.map(t => t.taskId === p.taskId ? { ...t, status: 'in_progress' as const, updatedAt: event.createdAt } : t) })
        break
      case 'UserInteractionRequested':
        set({ tasks: tasks.map(t => t.taskId === p.taskId ? { ...t, status: 'awaiting_user' as const, pendingInteractionId: p.interactionId as string, updatedAt: event.createdAt } : t) })
        break
      case 'UserInteractionResponded':
        set({ tasks: tasks.map(t => t.taskId === p.taskId ? { ...t, status: 'in_progress' as const, pendingInteractionId: undefined, updatedAt: event.createdAt } : t) })
        break
    }
  },
}))

// Subscribe to eventBus — decoupled from connectionStore
eventBus.on('domain-event', (event) => {
  useTaskStore.getState().applyEvent(event)
})