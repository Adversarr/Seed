/**
 * Stream store — accumulates real-time streaming output per task.
 * Used for showing live agent output in the task detail view.
 */

import { create } from 'zustand'
import type { UiEvent } from '@/types'

interface StreamChunk {
  kind: 'text' | 'reasoning' | 'verbose' | 'error'
  content: string
  timestamp: number
}

interface StreamState {
  /** Task ID → accumulated output chunks */
  streams: Record<string, StreamChunk[]>

  /** Handle incoming UiEvent from WebSocket */
  handleUiEvent: (event: UiEvent) => void

  /** Clear stream data for a task */
  clearStream: (taskId: string) => void
}

export const useStreamStore = create<StreamState>((set, get) => ({
  streams: {},

  handleUiEvent: (event) => {
    if (event.type === 'agent_output' || event.type === 'stream_delta') {
      const { taskId, kind, content } = event.payload
      const streams = { ...get().streams }
      const chunks = [...(streams[taskId] ?? [])]

      // For stream_delta, append to the last chunk of same kind, or create new
      if (event.type === 'stream_delta' && chunks.length > 0) {
        const last = chunks[chunks.length - 1]!
        if (last.kind === kind) {
          chunks[chunks.length - 1] = { ...last, content: last.content + content }
        } else {
          chunks.push({ kind, content, timestamp: Date.now() })
        }
      } else {
        chunks.push({ kind, content, timestamp: Date.now() })
      }

      streams[taskId] = chunks
      set({ streams })
    }

    if (event.type === 'stream_end') {
      // Clear stream data to prevent unbounded memory growth (NEW-F4)
      const { taskId } = event.payload
      const streams = { ...get().streams }
      delete streams[taskId]
      set({ streams })
    }
  },

  clearStream: (taskId) => {
    const streams = { ...get().streams }
    delete streams[taskId]
    set({ streams })
  },
}))
