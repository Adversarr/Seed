/**
 * ConnectionIndicator — shows WebSocket connection status in the header.
 */

import { Wifi, WifiOff, Loader2 } from 'lucide-react'
import { useConnectionStore } from '@/stores'

export function ConnectionIndicator() {
  const status = useConnectionStore(s => s.status)

  switch (status) {
    case 'connected':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
          <Wifi size={14} />
          Connected
        </span>
      )
    case 'connecting':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-amber-400">
          <Loader2 size={14} className="animate-spin" />
          Connecting
        </span>
      )
    case 'disconnected':
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-red-400">
          <WifiOff size={14} />
          Disconnected
        </span>
      )
  }
}
