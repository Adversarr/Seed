/**
 * ConversationView — chat-like interface for viewing task conversation history.
 *
 * Uses ai-elements Message components to render a rich conversation timeline
 * that combines stored events with live streaming output. Provides feature
 * parity with the TUI's InteractionPane.
 */

import { useCallback, useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'
import { timeAgo } from '@/lib/utils'
import { useConversationStore, type ConversationMessage } from '@/stores/conversationStore'
import { useStreamStore } from '@/stores/streamStore'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { Shimmer } from '@/components/ai-elements/shimmer'
import {
  Bot, User, AlertCircle, Info, MessageSquare, Pause, Play, XCircle, CheckCircle,
} from 'lucide-react'

// ── Helpers ────────────────────────────────────────────────────────────

// Status icons are inlined in the renderers below.

function statusLabel(content: string): { icon: React.ReactNode; color: string } {
  if (content.includes('created')) return { icon: <CheckCircle className="h-3 w-3" />, color: 'text-emerald-400' }
  if (content.includes('started')) return { icon: <Play className="h-3 w-3" />, color: 'text-violet-400' }
  if (content.includes('completed') || content.includes('Task completed')) return { icon: <CheckCircle className="h-3 w-3" />, color: 'text-emerald-400' }
  if (content.includes('failed')) return { icon: <XCircle className="h-3 w-3" />, color: 'text-red-400' }
  if (content.includes('paused')) return { icon: <Pause className="h-3 w-3" />, color: 'text-zinc-400' }
  if (content.includes('resumed')) return { icon: <Play className="h-3 w-3" />, color: 'text-violet-400' }
  if (content.includes('canceled')) return { icon: <XCircle className="h-3 w-3" />, color: 'text-zinc-500' }
  return { icon: <Info className="h-3 w-3" />, color: 'text-zinc-500' }
}

// ── Message renderers ──────────────────────────────────────────────────

function SystemMessage({ msg }: { msg: ConversationMessage }) {
  const { icon, color } = statusLabel(msg.content)
  return (
    <div className="flex items-center justify-center gap-2 py-1.5">
      <div className={cn('flex items-center gap-1.5 text-xs', color)}>
        {icon}
        <span>{msg.content}</span>
      </div>
      <span className="text-[10px] text-zinc-700">{timeAgo(msg.timestamp)}</span>
    </div>
  )
}

function UserMessage({ msg }: { msg: ConversationMessage }) {
  return (
    <Message from="user">
      <div className="flex items-center gap-2 justify-end">
        <span className="text-[10px] text-zinc-600">{timeAgo(msg.timestamp)}</span>
        <div className="rounded-full bg-violet-600/20 p-1">
          <User className="h-3 w-3 text-violet-400" />
        </div>
      </div>
      <MessageContent>
        <MessageResponse>{msg.content}</MessageResponse>
      </MessageContent>
    </Message>
  )
}

function AssistantMessage({ msg }: { msg: ConversationMessage }) {
  return (
    <Message from="assistant">
      <div className="flex items-center gap-2">
        <div className="rounded-full bg-zinc-800 p-1">
          <Bot className="h-3 w-3 text-zinc-400" />
        </div>
        <span className="text-[10px] text-zinc-600">{timeAgo(msg.timestamp)}</span>
      </div>
      <MessageContent>
        {msg.kind === 'interaction' ? (
          <div className="rounded-md border border-amber-800/40 bg-amber-950/20 px-3 py-2">
            <p className="text-sm text-amber-200">{msg.content}</p>
            {msg.metadata?.kind != null && (
              <span className="inline-block mt-1 text-[10px] text-amber-500/60 bg-amber-900/20 px-1.5 rounded">
                {String(msg.metadata.kind)}
              </span>
            )}
          </div>
        ) : msg.kind === 'error' ? (
          <div className="rounded-md border border-red-800/40 bg-red-950/20 px-3 py-2">
            <div className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
              <p className="text-sm text-red-300">{msg.content}</p>
            </div>
          </div>
        ) : (
          <MessageResponse>{msg.content}</MessageResponse>
        )}
      </MessageContent>
    </Message>
  )
}

function ConversationMessageItem({ msg }: { msg: ConversationMessage }) {
  switch (msg.role) {
    case 'system': return <SystemMessage msg={msg} />
    case 'user': return <UserMessage msg={msg} />
    case 'assistant': return <AssistantMessage msg={msg} />
    default: return null
  }
}

// ── Live streaming section ─────────────────────────────────────────────

function LiveStream({ taskId }: { taskId: string }) {
  const stream = useStreamStore(s => s.streams[taskId])
  if (!stream || stream.chunks.length === 0) return null

  const textContent = stream.chunks
    .filter(c => c.kind === 'text')
    .map(c => c.content)
    .join('')

  const reasoningContent = stream.chunks
    .filter(c => c.kind === 'reasoning')
    .map(c => c.content)
    .join('')

  const errorContent = stream.chunks
    .filter(c => c.kind === 'error')
    .map(c => c.content)
    .join('')

  return (
    <div className="space-y-3">
      {/* Reasoning collapsible */}
      {reasoningContent && (
        <Reasoning isStreaming={!stream.completed} defaultOpen>
          <ReasoningTrigger />
          <ReasoningContent>{reasoningContent}</ReasoningContent>
        </Reasoning>
      )}

      {/* Main text output */}
      {textContent && (
        <Message from="assistant">
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-zinc-800 p-1">
              <Bot className="h-3 w-3 text-zinc-400" />
            </div>
            {!stream.completed && <Shimmer className="h-3">thinking…</Shimmer>}
          </div>
          <MessageContent>
            <MessageResponse>{textContent}</MessageResponse>
          </MessageContent>
        </Message>
      )}

      {/* Error output */}
      {errorContent && (
        <Message from="assistant">
          <MessageContent>
            <div className="rounded-md border border-red-800/40 bg-red-950/20 px-3 py-2">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-400 mt-0.5 shrink-0" />
                <pre className="text-xs text-red-300 whitespace-pre-wrap">{errorContent}</pre>
              </div>
            </div>
          </MessageContent>
        </Message>
      )}
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────

interface ConversationViewProps {
  taskId: string
  className?: string
}

export function ConversationView({ taskId, className }: ConversationViewProps) {
  const messages = useConversationStore(s => s.getMessages(taskId))
  const loading = useConversationStore(s => s.loadingTasks.has(taskId))
  const fetchConversation = useConversationStore(s => s.fetchConversation)
  const scrollRef = useRef<HTMLDivElement>(null)
  const isNearBottomRef = useRef(true)

  useEffect(() => {
    fetchConversation(taskId)
  }, [taskId, fetchConversation])

  // Track if user is near bottom to decide whether to auto-scroll (B5)
  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const threshold = 80 // px from bottom
    isNearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold
  }, [])

  // Auto-scroll only when near bottom
  useEffect(() => {
    if (scrollRef.current && isNearBottomRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages.length])

  if (loading && messages.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-zinc-500">
        <Shimmer className="h-4">Loading conversation…</Shimmer>
      </div>
    )
  }

  return (
    <div className={cn('flex flex-col', className)}>
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 space-y-4 overflow-y-auto px-1 py-4 min-h-0"
      >
        {messages.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
            <MessageSquare className="h-8 w-8 mb-2 text-zinc-700" />
            <p className="text-sm">No conversation yet.</p>
          </div>
        )}

        {messages.map(msg => (
          <ConversationMessageItem key={msg.id} msg={msg} />
        ))}

        {/* Live streaming output at the bottom */}
        <LiveStream taskId={taskId} />
      </div>
    </div>
  )
}
