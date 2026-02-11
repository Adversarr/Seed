/**
 * Stream store — accumulates real-time streaming output per task.
 *
 * Subscribes to eventBus for real-time updates (decoupled from connectionStore).
 * Marks streams as completed on stream_end instead of deleting them,
 * so users can still review output after the agent finishes.
 */

import { create } from 'zustand'
import type { UiEvent } from '@/types'
import { eventBus } from './eventBus'
import { StreamPayload, StreamEndPayload, safeParse } from '@/schemas/eventPayloads'

interface StreamChunk {
  kind: 'text' | 'reasoning' | 'verbose' | 'error'
  content: string
  timestamp: number
}

interface TaskStream {
  chunks: StreamChunk[]
  /** Whether the agent has finished streaming for this task. */
  completed: boolean
}

interface StreamState {
  /** Task ID → stream data */
  streams: Record<string, TaskStream>

  /** Handle incoming UiEvent from WebSocket */
  handleUiEvent: (event: UiEvent) => void

  /** Clear stream data for a task */
  clearStream: (taskId: string) => void
}

/** Max chunks per task stream to prevent unbounded memory growth. */
const MAX_STREAM_CHUNKS = 5000

export const useStreamStore = create<StreamState>((set, get) => ({
  streams: {},

  handleUiEvent: (event) => {
    if (event.type === 'agent_output' || event.type === 'stream_delta') {
      const p = safeParse(StreamPayload, event.payload, event.type)
      if (!p) return
      const { taskId, kind, content } = p
      const streams = { ...get().streams }
      const existing = streams[taskId] ?? { chunks: [], completed: false }
      const chunks = [...existing.chunks]

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

      streams[taskId] = {
        chunks: chunks.length > MAX_STREAM_CHUNKS ? chunks.slice(-MAX_STREAM_CHUNKS) : chunks,
        completed: false,
      }
      set({ streams })
    }

    if (event.type === 'stream_end') {
      // Mark as completed rather than deleting — preserves output for review
      const p = safeParse(StreamEndPayload, event.payload, event.type)
      if (!p) return
      const { taskId } = p
      const streams = { ...get().streams }
      const existing = streams[taskId]
      if (existing) {
        streams[taskId] = { ...existing, completed: true }
        set({ streams })
      }
    }
  },

  clearStream: (taskId) => {
    const streams = { ...get().streams }
    delete streams[taskId]
    set({ streams })
  },
}))

// Subscribe to eventBus — decoupled from connectionStore
eventBus.on('ui-event', (event) => {
  useStreamStore.getState().handleUiEvent(event)
})
