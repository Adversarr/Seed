/**
 * Runtime store — fetches and caches agent registry and runtime configuration.
 *
 * Provides agent list, default agent, streaming toggle, and profile management.
 * Data comes from GET /api/runtime.
 */

import { create } from 'zustand'
import { api } from '@/services/api'
import type { RuntimeLLMProfile, ToolRiskMode } from '@/types'

export interface AgentInfo {
  id: string
  displayName: string
  description: string
}

interface RuntimeState {
  agents: AgentInfo[]
  defaultAgentId: string | null
  streamingEnabled: boolean
  toolRiskMode: ToolRiskMode
  availableToolRiskModes: ToolRiskMode[]
  llmProvider: 'fake' | 'openai' | 'bailian' | 'volcengine' | null
  defaultProfile: string | null
  globalProfileOverride: string | null
  profiles: RuntimeLLMProfile[]
  loading: boolean
  error: string | null

  /** Fetch runtime config from the server. */
  fetchRuntime: (opts?: { signal?: AbortSignal }) => Promise<void>
  /** Set tool risk mode at runtime. */
  setToolRiskMode: (mode: ToolRiskMode) => Promise<void>

  /** Get a specific agent by ID. */
  getAgent: (id: string) => AgentInfo | undefined
}

export const useRuntimeStore = create<RuntimeState>((set, get) => ({
  agents: [],
  defaultAgentId: null,
  streamingEnabled: false,
  toolRiskMode: 'autorun_no_public',
  availableToolRiskModes: [],
  llmProvider: null,
  defaultProfile: null,
  globalProfileOverride: null,
  profiles: [],
  loading: false,
  error: null,

  fetchRuntime: async (opts?: { signal?: AbortSignal }) => {
    set({ loading: true, error: null })
    try {
      const data = await api.getRuntime(opts)
      set({
        agents: data.agents,
        defaultAgentId: data.defaultAgentId,
        streamingEnabled: data.streamingEnabled,
        toolRiskMode: data.toolRiskMode,
        availableToolRiskModes: data.availableToolRiskModes,
        llmProvider: data.llm.provider,
        defaultProfile: data.llm.defaultProfile,
        globalProfileOverride: data.llm.globalProfileOverride,
        profiles: data.llm.profiles,
        loading: false,
      })
    } catch (e) {
      set({ error: (e as Error).message, loading: false })
    }
  },

  setToolRiskMode: async (mode: ToolRiskMode) => {
    set({ error: null })
    try {
      await api.setRuntimeRiskMode(mode)
      set({ toolRiskMode: mode })
    } catch (e) {
      set({ error: (e as Error).message })
      throw e
    }
  },

  getAgent: (id) => get().agents.find(a => a.id === id),
}))
