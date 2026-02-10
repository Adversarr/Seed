/**
 * StatusBadge — colored pill for task status.
 */

import { cn } from '@/lib/utils'
import type { TaskStatus } from '@/types'

const statusConfig: Record<TaskStatus, { label: string; className: string }> = {
  open:           { label: 'Open',          className: 'bg-zinc-700 text-zinc-200' },
  in_progress:    { label: 'Running',       className: 'bg-violet-900/60 text-violet-300 animate-pulse' },
  awaiting_user:  { label: 'Awaiting User', className: 'bg-amber-900/60 text-amber-300' },
  paused:         { label: 'Paused',        className: 'bg-zinc-600 text-zinc-300' },
  done:           { label: 'Done',          className: 'bg-emerald-900/60 text-emerald-300' },
  failed:         { label: 'Failed',        className: 'bg-red-900/60 text-red-300' },
  canceled:       { label: 'Canceled',      className: 'bg-zinc-700 text-zinc-400 line-through' },
}

export function StatusBadge({ status }: { status: TaskStatus }) {
  const config = statusConfig[status] ?? statusConfig.open
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', config.className)}>
      {config.label}
    </span>
  )
}
