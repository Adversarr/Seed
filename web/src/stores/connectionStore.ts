/**
 * Connection store — tracks WebSocket connection status and manages lifecycle.
 */

import { create } from 'zustand'
import { WsService, type ConnectionStatus } from '@/services/ws'
import { useTaskStore } from './taskStore'
import { useStreamStore } from './streamStore'

interface ConnectionState {
  status: ConnectionStatus
  wsService: WsService | null
  connect: () => void
  disconnect: () => void
}

export const useConnectionStore = create<ConnectionState>((set, get) => ({
  status: 'disconnected',
  wsService: null,

  connect: () => {
    if (get().wsService) return

    const ws = new WsService({
      onStatusChange: (status) => set({ status }),
      onEvent: (event) => {
        useTaskStore.getState().applyEvent(event)
      },
      onUiEvent: (event) => {
        useStreamStore.getState().handleUiEvent(event)
      },
    })
    set({ wsService: ws })
    ws.connect()
  },

  disconnect: () => {
    get().wsService?.disconnect()
    set({ wsService: null, status: 'disconnected' })
  },
}))
