/**
 * StreamOutput — renders live agent streaming output for a task.
 *
 * Uses ai-elements Reasoning and Message components for rich output.
 * Falls back to raw terminal view when there's only verbose/error content.
 */

import { useMemo } from 'react'
import { useStreamStore } from '@/stores'
import { Terminal, TerminalContent, TerminalHeader, TerminalTitle } from '@/components/ai-elements/terminal'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import { Shimmer } from '@/components/ai-elements/shimmer'
import { Bot } from 'lucide-react'

type StreamChunk = {
  kind: 'text' | 'reasoning' | 'verbose' | 'error'
  content: string
  timestamp: number
}

function chunkToAnsi(chunk: StreamChunk): string {
  switch (chunk.kind) {
    case 'error':
      return `\u001b[31m${chunk.content}\u001b[0m`
    case 'reasoning':
      return `\u001b[2m${chunk.content}\u001b[0m`
    case 'verbose':
      return `\u001b[2m${chunk.content}\u001b[0m`
    case 'text':
      return chunk.content
  }
}

export function StreamOutput({ taskId }: { taskId: string }) {
  const stream = useStreamStore(s => s.streams[taskId])
  const clearStream = useStreamStore(s => s.clearStream)

  const chunks = stream?.chunks ?? []
  const isStreaming = stream ? !stream.completed : false

  const textContent = useMemo(() => chunks.filter(c => c.kind === 'text').map(c => c.content).join(''), [chunks])
  const reasoningContent = useMemo(() => chunks.filter(c => c.kind === 'reasoning').map(c => c.content).join(''), [chunks])
  const verboseContent = useMemo(() => chunks.filter(c => c.kind === 'verbose' || c.kind === 'error').map(chunkToAnsi).join(''), [chunks])

  if (chunks.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-zinc-600">
        <p className="text-sm">No output yet. Waiting for agent…</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Reasoning section */}
      {reasoningContent && (
        <Reasoning isStreaming={isStreaming} defaultOpen>
          <ReasoningTrigger />
          <ReasoningContent>{reasoningContent}</ReasoningContent>
        </Reasoning>
      )}

      {/* Main text output as markdown */}
      {textContent && (
        <Message from="assistant">
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-zinc-800 p-1">
              <Bot className="h-3 w-3 text-zinc-400" />
            </div>
            {isStreaming && <Shimmer className="h-3">generating…</Shimmer>}
            {stream?.completed && <span className="text-[10px] text-zinc-600">completed</span>}
          </div>
          <MessageContent>
            <MessageResponse>{textContent}</MessageResponse>
          </MessageContent>
        </Message>
      )}

      {/* Verbose/error as raw terminal */}
      {verboseContent && (
        <Terminal output={verboseContent} onClear={() => clearStream(taskId)} className="border-border bg-zinc-950">
          <TerminalHeader>
            <TerminalTitle>Raw Output</TerminalTitle>
          </TerminalHeader>
          <TerminalContent />
        </Terminal>
      )}
    </div>
  )
}
