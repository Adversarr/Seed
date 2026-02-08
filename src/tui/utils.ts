import { parse, setOptions } from 'marked'
import type { Renderer } from 'marked'
import TerminalRenderer from 'marked-terminal'
import type { StoredAuditEntry } from '../domain/ports/auditLog.js'
import type { TaskView } from './types.js'

export function renderMarkdownToTerminalText(markdown: string, width: number): string {
  if (!markdown) return ''
  const safeWidth = Math.max(20, width)
  const renderer = new TerminalRenderer({
    width: safeWidth,
    reflowText: true,
    showSectionPrefix: false
  }) as unknown as Renderer
  setOptions({
    renderer
  })
  return parse(markdown).trimEnd()
}

export function getStatusIcon(status: string): string {
  switch (status) {
    case 'open': return '⚪'
    case 'in_progress': return '🔵'
    case 'awaiting_user': return '🟡'
    case 'paused': return '⏸️'
    case 'done': return '🟢'
    case 'failed': return '🔴'
    case 'canceled': return '⚪'
    default: return ' '
  }
}

export function truncateText(value: string, maxLength: number): string {
  if (maxLength <= 0) return ''
  if (value.length <= maxLength) return value
  return value.slice(0, Math.max(0, maxLength - 1)) + '…'
}

export function createSeparatorLine(columns: number): string {
  const width = Math.max(0, columns)
  return '─'.repeat(width)
}

function truncateLongString(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value
  const suffix = '...(truncated)'
  const sliceLength = Math.max(0, maxLength - suffix.length)
  return value.slice(0, sliceLength) + suffix
}

function formatToolPayload(value: unknown, maxLength: number): string {
  if (typeof value === 'string') {
    return truncateLongString(value, maxLength)
  }
  const raw = JSON.stringify(value)
  return typeof raw === 'string' ? raw : String(value)
}

const toolFormatters: Record<string, (output: any) => string | null> = {
  readFile: (output: any) => {
    if (output && typeof output.path === 'string' && typeof output.lineCount === 'number') {
      return `Read ${output.path} (${output.lineCount} lines)`
    }
    return null
  },
  listFiles: (output: any) => {
    if (output && typeof output.path === 'string' && typeof output.count === 'number') {
      return `List ${output.path} (${output.count} entries)`
    }
    return null
  }
}

export function formatAuditEntry(entry: StoredAuditEntry): {
  line: string
  color?: string
  dim?: boolean
  bold?: boolean
} {
  if (entry.type === 'ToolCallRequested') {
    const input = formatToolPayload(entry.payload.input, 200)
    return {
      line: ` → ${entry.payload.toolName} ${input}`,
      color: 'blue',
      dim: false
    }
  }

  let output: string
  const formatter = toolFormatters[entry.payload.toolName]
  const formattedCustom = formatter ? formatter(entry.payload.output) : null

  if (formattedCustom) {
    output = formattedCustom
  } else {
    output = formatToolPayload(entry.payload.output, 200)
  }

  if (entry.payload.isError) {
    return {
      line: ` ✖ ${entry.payload.toolName} error (${entry.payload.durationMs}ms) ${output}`,
      color: 'red',
      bold: true
    }
  }
  return {
    line: ` ✓ ${entry.payload.toolName} ok (${entry.payload.durationMs}ms) ${output}`,
    color: 'blue',
    dim: true
  }
}

export function buildCommandLineFromInput(opts: {
  input: string
  focusedTaskId: string | null
  tasks: TaskView[]
}): string {
  const trimmed = opts.input.trim()
  if (!trimmed) return ''
  if (trimmed.startsWith('/')) return trimmed

  if (!opts.focusedTaskId) {
    return `/new ${trimmed}`
  }

  const focusedTask = opts.tasks.find((task) => task.taskId === opts.focusedTaskId)
  const focusedTaskStatus = focusedTask?.status

  if (focusedTaskStatus === 'awaiting_user') {
    return `/continue ${trimmed}`
  }

  return `/continue ${trimmed}`
}
