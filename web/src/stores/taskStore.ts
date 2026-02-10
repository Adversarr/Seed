/**
 * Task store — client-side projection of tasks from events.
 */

import { create } from 'zustand'
import type { TaskView, StoredEvent } from '@/types'
import { api } from '@/services/api'

interface TaskState {
  tasks: TaskView[]
  loading: boolean
  error: string | null

  /** Initial fetch from HTTP */
  fetchTasks: () => Promise<void>

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

  applyEvent: (event) => {
    const { tasks } = get()
    const p = event.payload as Record<string, unknown>

    switch (event.type) {
      case 'TaskCreated': {
        // Avoid duplicates
        if (tasks.some(t => t.taskId === p.taskId)) return
        const newTask: TaskView = {
          taskId: p.taskId as string,
          title: p.title as string,
          intent: (p.intent as string) ?? '',
          createdBy: p.authorActorId as string,
          agentId: p.agentId as string,
          priority: (p.priority as TaskView['priority']) ?? 'foreground',
          status: 'open',
          parentTaskId: p.parentTaskId as string | undefined,
          createdAt: event.createdAt,
          updatedAt: event.createdAt,
        }
        set({ tasks: [...tasks, newTask] })
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
