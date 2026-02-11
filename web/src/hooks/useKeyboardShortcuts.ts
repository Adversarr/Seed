/**
 * useKeyboardShortcuts — global keyboard shortcut handler for the web UI.
 *
 * Shortcuts:
 *   Ctrl/⌘ + N  → Open "New Task" dialog (emits custom event)
 *   Ctrl/⌘ + K  → Focus search / filter (future)
 *   Escape       → Navigate back
 *   g then h     → Go home (dashboard)
 *   g then a     → Go to activity
 *   g then s     → Go to settings
 *
 * The hook attaches a single global keydown listener and cleans up on unmount.
 */

import { useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

/** Custom events the shortcuts can emit (listened to by consuming components). */
export const SHORTCUT_EVENTS = {
  NEW_TASK: 'shortcut:new-task',
} as const

interface ShortcutOptions {
  /** Set to false to disable all shortcuts (e.g. when a modal is open). */
  enabled?: boolean
}

export function useKeyboardShortcuts(opts: ShortcutOptions = {}) {
  const { enabled = true } = opts
  const navigate = useNavigate()
  const gPrefixRef = useRef(false)
  const gTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!enabled) return

    const handler = (e: KeyboardEvent) => {
      // Ignore when user is typing in an input / textarea / contentEditable
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable) {
        // Allow Escape even in inputs
        if (e.key !== 'Escape') return
      }

      const mod = e.metaKey || e.ctrlKey

      // Ctrl/⌘ + N — New task
      if (mod && e.key === 'n') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent(SHORTCUT_EVENTS.NEW_TASK))
        return
      }

      // Escape — Go back
      if (e.key === 'Escape') {
        e.preventDefault()
        navigate(-1)
        return
      }

      // "g" prefix sequences (vim-style)
      if (e.key === 'g' && !mod) {
        if (gPrefixRef.current) return // already in sequence
        gPrefixRef.current = true
        if (gTimerRef.current) clearTimeout(gTimerRef.current)
        gTimerRef.current = setTimeout(() => { gPrefixRef.current = false }, 600)
        return
      }

      if (gPrefixRef.current) {
        gPrefixRef.current = false
        if (gTimerRef.current) clearTimeout(gTimerRef.current)
        switch (e.key) {
          case 'h': navigate('/'); return
          case 'a': navigate('/activity'); return
          case 's': navigate('/settings'); return
        }
      }
    }

    window.addEventListener('keydown', handler)
    return () => {
      window.removeEventListener('keydown', handler)
      if (gTimerRef.current) clearTimeout(gTimerRef.current)
    }
  }, [enabled, navigate])
}
