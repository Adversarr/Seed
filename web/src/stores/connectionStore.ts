/**
 * Connection store — tracks WebSocket connection status and manages lifecycle.
 *
 * Publishes events to the eventBus instead of calling stores directly.
 * Individual stores subscribe to the bus independently.
 */

import { create } from 'zustand'
import { WsService, type ConnectionStatus } from '@/services/ws'
import { eventBus } from './eventBus'

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
      onEvent: (event) => eventBus.emit('domain-event', event),
      onUiEvent: (event) => eventBus.emit('ui-event', event),
    })
    set({ wsService: ws })
    ws.connect()
  },

  disconnect: () => {
    get().wsService?.disconnect()
    set({ wsService: null, status: 'disconnected' })
  },
}))
