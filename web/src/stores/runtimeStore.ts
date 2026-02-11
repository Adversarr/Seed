/**
 * Runtime store — fetches and caches agent registry and runtime configuration.
 *
 * Provides agent list, default agent, streaming toggle, and profile management.
 * Data comes from GET /api/runtime.
 */

import { create } from 'zustand'
import { api } from '@/services/api'

export interface AgentInfo {
  id: string
  displayName: string
  description: string
}

interface RuntimeState {
  agents: AgentInfo[]
  defaultAgentId: string | null
  streamingEnabled: boolean
  loading: boolean
  error: string | null

  /** Fetch runtime config from the server. */
  fetchRuntime: () => Promise<void>

  /** Get a specific agent by ID. */
  getAgent: (id: string) => AgentInfo | undefined
}

export const useRuntimeStore = create<RuntimeState>((set, get) => ({
  agents: [],
  defaultAgentId: null,
  streamingEnabled: false,
  loading: false,
  error: null,

  fetchRuntime: async () => {
    set({ loading: true, error: null })
    try {
      const data = await api.getRuntime()
      set({
        agents: data.agents,
        defaultAgentId: data.defaultAgentId,
        streamingEnabled: data.streamingEnabled,
        loading: false,
      })
    } catch (e) {
      set({ error: (e as Error).message, loading: false })
    }
  },

  getAgent: (id) => get().agents.find(a => a.id === id),
}))
