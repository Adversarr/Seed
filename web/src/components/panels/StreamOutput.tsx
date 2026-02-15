/**
 * StreamOutput — renders both:
 * 1) live UI events (agent_output/tool lifecycle) for immediate feedback
 * 2) persisted replay transcript from conversation history
 *
 * This keeps TaskDetail responsive during agent execution while preserving
 * the durable replay view as the source of record after persistence.
 */

import { useEffect, useMemo } from 'react'
import { useConversationStore, type ConversationMessage, type MessagePart } from '@/stores/conversationStore'
import { useStreamStore, type StreamChunk } from '@/stores/streamStore'

type TranscriptBlock = {
  id: string
  label: string
  content: string
  isError?: boolean
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function detectToolError(content: string): boolean {
  try {
    const parsed = JSON.parse(content)
    if (typeof parsed === 'object' && parsed !== null) {
      if ('isError' in parsed && parsed.isError === true) return true
      if ('error' in parsed && typeof parsed.error === 'string' && parsed.error.length > 0) return true
    }
    return false
  } catch {
    return /^(error:|fatal:|exception:|failed to |cannot |unable to )/i.test(content.trim())
  }
}

function partToBlocks(messageId: string, role: ConversationMessage['role'], part: MessagePart, index: number): TranscriptBlock[] {
  const id = `${messageId}-${index}`

  switch (part.kind) {
    case 'text': {
      if (role === 'assistant') return [{ id, label: 'Assistant', content: part.content }]
      if (role === 'user') return [{ id, label: 'User', content: part.content }]
      if (role === 'system') return [{ id, label: 'System', content: part.content }]
      return [{ id, label: 'Text', content: part.content }]
    }
    case 'reasoning':
      return [{ id, label: 'Assistant Reasoning', content: part.content }]
    case 'tool_call':
      return [{
        id,
        label: `Tool Call: ${part.toolName}`,
        content: stringify(part.arguments),
      }]
    case 'tool_result': {
      const error = detectToolError(part.content)
      return [{
        id,
        label: `Tool Result: ${part.toolName ?? 'tool'}`,
        content: part.content,
        isError: error,
      }]
    }
  }
}

function buildTranscriptBlocks(messages: ConversationMessage[]): TranscriptBlock[] {
  return messages.flatMap(message =>
    message.parts.flatMap((part, idx) => partToBlocks(message.id, message.role, part, idx)),
  )
}

function formatLiveToolCallContent(chunk: StreamChunk): string {
  if (chunk.kind !== 'tool_call') return chunk.content
  if (!chunk.toolArguments) return chunk.content
  return `${chunk.content}\n\nArguments:\n${stringify(chunk.toolArguments)}`
}

function liveChunkToBlock(taskId: string, chunk: StreamChunk, index: number): TranscriptBlock {
  const id = `live-${taskId}-${chunk.timestamp}-${index}`

  switch (chunk.kind) {
    case 'text':
      return { id, label: 'Assistant (Live)', content: chunk.content }
    case 'reasoning':
      return { id, label: 'Assistant Reasoning (Live)', content: chunk.content }
    case 'verbose':
      return { id, label: 'Agent Status (Live)', content: chunk.content }
    case 'error':
      return { id, label: 'Agent Error (Live)', content: chunk.content, isError: true }
    case 'tool_call':
      return {
        id,
        label: `Tool Call (Live): ${chunk.toolName ?? 'tool'}`,
        content: formatLiveToolCallContent(chunk),
      }
    case 'tool_result':
      return {
        id,
        label: `Tool Result (Live): ${chunk.toolName ?? 'tool'}`,
        content: chunk.content,
        isError: chunk.isError,
      }
  }
}

function renderBlock(block: TranscriptBlock) {
  return (
    <section key={block.id} className="rounded-md border border-zinc-800/80 bg-zinc-950/40 p-3">
      <p className="text-[11px] uppercase tracking-wide text-zinc-500">{block.label}</p>
      <pre
        className={[
          'mt-2 whitespace-pre-wrap break-words text-sm leading-6 font-mono',
          block.isError ? 'text-red-300' : 'text-zinc-200',
        ].join(' ')}
      >
        {block.content}
      </pre>
    </section>
  )
}

export function StreamOutput({ taskId }: { taskId: string }) {
  const messages = useConversationStore(s => s.getMessages(taskId))
  const loading = useConversationStore(s => s.loadingTasks.has(taskId))
  const fetchConversation = useConversationStore(s => s.fetchConversation)
  const liveStream = useStreamStore(s => s.streams[taskId])

  useEffect(() => {
    fetchConversation(taskId)
  }, [taskId, fetchConversation])

  const blocks = useMemo(() => buildTranscriptBlocks(messages), [messages])
  const liveBlocks = useMemo(
    () => (liveStream?.chunks ?? []).map((chunk, idx) => liveChunkToBlock(taskId, chunk, idx)),
    [liveStream, taskId],
  )

  if (loading && blocks.length === 0 && liveBlocks.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-zinc-500">
        <p className="text-sm">Loading output transcript…</p>
      </div>
    )
  }

  if (blocks.length === 0 && liveBlocks.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-zinc-600">
        <p className="text-sm">No output transcript available yet.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {liveBlocks.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs uppercase tracking-wide text-zinc-400">Live Agent Activity</h3>
            <span className="text-[10px] text-zinc-600">
              {liveStream?.completed ? 'Completed' : 'Running'}
            </span>
          </div>
          {liveBlocks.map(renderBlock)}
        </section>
      )}

      {blocks.length > 0 && (
        <section className="space-y-3">
          {liveBlocks.length > 0 && (
            <h3 className="text-xs uppercase tracking-wide text-zinc-400">Persisted Transcript</h3>
          )}
          {blocks.map(renderBlock)}
        </section>
      )}
    </div>
  )
}

/**
 * Backward-compatible alias while callers migrate to replay-focused naming.
 */
export const ReplayOutput = StreamOutput
