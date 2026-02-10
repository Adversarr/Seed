/**
 * Settings page — connection settings and configuration.
 */

import { useState } from 'react'
import { useConnectionStore } from '@/stores'

export function SettingsPage() {
  const { status, connect, disconnect } = useConnectionStore()
  const [token, setToken] = useState(sessionStorage.getItem('coauthor-token') ?? '')

  const saveToken = () => {
    sessionStorage.setItem('coauthor-token', token)
    disconnect()
    setTimeout(connect, 100)
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-zinc-100">Settings</h1>

      <div className="space-y-4 max-w-md">
        <div>
          <label className="block text-sm text-zinc-400 mb-1">Auth Token</label>
          <input
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="Paste your auth token…"
            className="w-full rounded-md bg-zinc-800 border border-zinc-700 px-3 py-2 text-sm text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:ring-1 focus:ring-violet-500 font-mono"
          />
          <p className="text-xs text-zinc-600 mt-1">
            The token is shown when the server starts (in the terminal output).
          </p>
        </div>

        <button
          onClick={saveToken}
          className="px-4 py-2 rounded-md bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-colors"
        >
          Save & Reconnect
        </button>

        <div className="pt-4 border-t border-zinc-800">
          <p className="text-sm text-zinc-500">
            Connection status: <strong className="text-zinc-300">{status}</strong>
          </p>
        </div>
      </div>
    </div>
  )
}
