/**
 * ConversationView — replay-only chat interface for persisted task conversation history.
 *
 * Renders stored LLM messages with true interleaved parts ordering and tool pairing.
 * No live stream chunks are rendered in the web UI.
 */

import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { timeAgo } from '@/lib/utils'
import { useConversationStore, type ConversationMessage, type MessagePart } from '@/stores/conversationStore'
import { useTaskStore } from '@/stores/taskStore'
import { Conversation, ConversationContent, ConversationScrollButton } from '@/components/ai-elements/conversation'
import { Message, MessageContent, MessageResponse } from '@/components/ai-elements/message'
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@/components/ai-elements/reasoning'
import { Tool, ToolHeader, ToolContent, ToolInput, ToolOutput } from '@/components/ai-elements/tool'
import { Task, TaskTrigger, TaskContent, TaskItem } from '@/components/ai-elements/task'
import { StatusBadge } from '@/components/display/StatusBadge'
import {
  Bot, User, MessageSquare, GitBranch,
} from 'lucide-react'

/** Smarter error detection that avoids false positives like "No errors found". */
function detectToolError(content: string, isError?: boolean): boolean {
  if (typeof isError === 'boolean') return isError

  try {
    const parsed = JSON.parse(content)
    if (typeof parsed === 'object' && parsed !== null) {
      if ('isError' in parsed && parsed.isError === true) return true
      if ('error' in parsed && typeof parsed.error === 'string' && parsed.error.length > 0) return true
    }
    return false
  } catch {
    const lower = content.toLowerCase()
    return /^(error:|fatal:|exception:|failed to |cannot |unable to )/i.test(content.trim())
      || (lower.includes('"error"') && lower.includes('true'))
  }
}

/** Check if a tool call is a subtask creation call. */
function isSubtaskToolCall(toolName: string): boolean {
  return toolName.startsWith('create_subtask_')
}

function TextPart({ content }: { content: string }) {
  return <MessageResponse>{content}</MessageResponse>
}

function ReasoningPart({ content, defaultOpen = false }: { content: string; defaultOpen?: boolean }) {
  return (
    <Reasoning defaultOpen={defaultOpen}>
      <ReasoningTrigger />
      <ReasoningContent>{content}</ReasoningContent>
    </Reasoning>
  )
}

function ToolCallPart({ toolName, arguments: args, result }: {
  toolName: string
  arguments: Record<string, unknown>
  result?: { content: string; isError?: boolean }
}) {
  const hasResult = !!result
  const isError = result ? detectToolError(result.content, result.isError) : false
  const state = hasResult
    ? (isError ? 'output-error' : 'output-available')
    : 'input-available'

  return (
    <Tool>
      <ToolHeader type="dynamic-tool" state={state} toolName={toolName} />
      <ToolContent>
        <ToolInput input={args} />
        {result && (
          <ToolOutput output={result.content} errorText={isError ? result.content : undefined} />
        )}
      </ToolContent>
    </Tool>
  )
}

function SubtaskToolCallPart({ toolName, arguments: args, result }: {
  toolName: string
  arguments: Record<string, unknown>
  result?: { content: string; isError?: boolean }
}) {
  const agentId = toolName.replace('create_subtask_', '')
  const taskTitle = (args.title as string) || (args.intent as string) || `Subtask (${agentId})`

  let childTaskId: string | undefined
  let childStatus: string | undefined
  let childSummary: string | undefined

  if (result) {
    try {
      const parsed = JSON.parse(result.content)
      if (typeof parsed?.taskId === 'string') childTaskId = parsed.taskId
      if (typeof parsed?.subTaskStatus === 'string') childStatus = parsed.subTaskStatus
      const summary = parsed?.summary || parsed?.finalAssistantMessage
      if (typeof summary === 'string') childSummary = summary
    } catch {
      // Ignore non-JSON tool output; render with the generic output display.
    }
  }

  const childTask = useTaskStore(s =>
    childTaskId ? s.tasks.find(t => t.taskId === childTaskId) : undefined,
  )

  const displayStatus = childTask?.status
  const displaySummary = childTask?.summary || childSummary

  return (
    <Task>
      <TaskTrigger title={taskTitle}>
        <div className="flex w-full cursor-pointer items-center gap-2 text-sm transition-colors hover:text-foreground">
          <GitBranch className="h-4 w-4 text-violet-400 shrink-0" />
          <span className="flex-1 truncate">{taskTitle}</span>
          {displayStatus && <StatusBadge status={displayStatus} />}
          {!result && <span className="text-xs text-zinc-500">pending result</span>}
          {childStatus === 'Error' && (
            <span className="text-xs text-red-400">Failed</span>
          )}
        </div>
      </TaskTrigger>
      <TaskContent>
        {(args.intent || args.goal) ? (
          <TaskItem>{String(args.intent || args.goal)}</TaskItem>
        ) : null}
        <TaskItem>
          <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
            <Bot size={12} /> Agent: {agentId}
          </span>
        </TaskItem>
        {displaySummary && (
          <TaskItem>
            <div className="text-xs text-zinc-400 mt-1 whitespace-pre-wrap">{displaySummary}</div>
          </TaskItem>
        )}
        {childTaskId && (
          <TaskItem>
            <Link
              to={`/tasks/${childTaskId}`}
              className="text-xs text-violet-400 hover:text-violet-300 inline-flex items-center gap-1 mt-1"
            >
              View full details →
            </Link>
          </TaskItem>
        )}
      </TaskContent>
    </Task>
  )
}

function ToolResultPart({ toolName, content, isError }: { toolName?: string; content: string; isError?: boolean }) {
  const errorDetected = detectToolError(content, isError)
  const state = errorDetected ? 'output-error' : 'output-available'
  return (
    <Tool>
      <ToolHeader type="dynamic-tool" state={state} toolName={toolName ?? 'tool'} />
      <ToolContent>
        <ToolOutput output={content} errorText={errorDetected ? content : undefined} />
      </ToolContent>
    </Tool>
  )
}

function AssistantPartsRenderer({ parts, followingToolResults }: {
  parts: MessagePart[]
  followingToolResults: Map<string, MessagePart>
}) {
  return (
    <div className="space-y-3">
      {parts.map((part, idx) => {
        switch (part.kind) {
          case 'text':
            return <TextPart key={idx} content={part.content} />
          case 'reasoning':
            return <ReasoningPart key={idx} content={part.content} />
          case 'tool_call': {
            const result = followingToolResults.get(part.toolCallId)
            const resultData = result && result.kind === 'tool_result'
              ? { content: result.content, isError: undefined }
              : undefined

            if (isSubtaskToolCall(part.toolName)) {
              return (
                <SubtaskToolCallPart
                  key={idx}
                  toolName={part.toolName}
                  arguments={part.arguments}
                  result={resultData}
                />
              )
            }

            return (
              <ToolCallPart
                key={idx}
                toolName={part.toolName}
                arguments={part.arguments}
                result={resultData}
              />
            )
          }
          case 'tool_result':
            return <ToolResultPart key={idx} toolName={part.toolName} content={part.content} />
        }
      })}
    </div>
  )
}

function SystemMessage({ msg }: { msg: ConversationMessage }) {
  const textPart = msg.parts.find(p => p.kind === 'text')
  if (!textPart || textPart.kind !== 'text') return null

  return (
    <div className="flex items-center justify-center gap-2 py-1.5">
      <div className="flex items-center gap-1.5 text-xs text-zinc-500">
        <span>{textPart.content}</span>
      </div>
      <span className="text-[10px] text-zinc-700">{timeAgo(msg.timestamp)}</span>
    </div>
  )
}

function UserMessage({ msg }: { msg: ConversationMessage }) {
  const textPart = msg.parts.find(p => p.kind === 'text')
  if (!textPart || textPart.kind !== 'text') return null

  return (
    <Message from="user">
      <div className="flex items-center gap-2 justify-end">
        <span className="text-[10px] text-zinc-600">{timeAgo(msg.timestamp)}</span>
        <div className="rounded-full bg-violet-600/20 p-1">
          <User className="h-3 w-3 text-violet-400" />
        </div>
      </div>
      <MessageContent>
        <MessageResponse>{textPart.content}</MessageResponse>
      </MessageContent>
    </Message>
  )
}

function AssistantMessage({ msg, followingToolResults }: {
  msg: ConversationMessage
  followingToolResults: Map<string, MessagePart>
}) {
  if (msg.parts.length === 0) return null

  return (
    <Message from="assistant">
      <div className="flex items-center gap-2">
        <div className="rounded-full bg-zinc-800 p-1">
          <Bot className="h-3 w-3 text-zinc-400" />
        </div>
        <span className="text-[10px] text-zinc-600">{timeAgo(msg.timestamp)}</span>
      </div>
      <MessageContent>
        <AssistantPartsRenderer parts={msg.parts} followingToolResults={followingToolResults} />
      </MessageContent>
    </Message>
  )
}

/**
 * Pair assistant tool_call parts with following tool_result messages.
 * Returns the per-assistant pairing map and a set of consumed tool message IDs.
 */
function buildToolResultPairings(messages: ConversationMessage[]) {
  const pairings = new Map<string, Map<string, MessagePart>>()
  const consumedToolMsgIds = new Set<string>()

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!
    if (msg.role !== 'assistant') continue

    const toolCallIds = msg.parts
      .filter((p): p is MessagePart & { kind: 'tool_call' } => p.kind === 'tool_call')
      .map(p => p.toolCallId)

    if (toolCallIds.length === 0) continue

    const resultMap = new Map<string, MessagePart>()

    for (let j = i + 1; j < messages.length; j++) {
      const next = messages[j]!
      if (next.role === 'tool') {
        const resultPart = next.parts.find(p => p.kind === 'tool_result')
        if (resultPart && resultPart.kind === 'tool_result' && toolCallIds.includes(resultPart.toolCallId)) {
          resultMap.set(resultPart.toolCallId, resultPart)
          consumedToolMsgIds.add(next.id)
        }
      } else if (next.role === 'assistant') {
        break
      }
    }

    pairings.set(msg.id, resultMap)
  }

  return { pairings, consumedToolMsgIds }
}

interface ConversationViewProps {
  taskId: string
  className?: string
}

export function ConversationView({ taskId, className }: ConversationViewProps) {
  const messages = useConversationStore(s => s.getMessages(taskId))
  const loading = useConversationStore(s => s.loadingTasks.has(taskId))
  const fetchConversation = useConversationStore(s => s.fetchConversation)

  useEffect(() => {
    fetchConversation(taskId)
  }, [taskId, fetchConversation])

  const { pairings, consumedToolMsgIds } = useMemo(
    () => buildToolResultPairings(messages),
    [messages],
  )

  if (loading && messages.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-zinc-500">
        <p className="text-sm">Loading conversation…</p>
      </div>
    )
  }

  const isEmpty = messages.length === 0 && !loading

  return (
    <Conversation className={cn('flex flex-col', className)}>
      <ConversationContent className="gap-4 px-1 py-4">
        {isEmpty && (
          <div className="flex flex-col items-center justify-center py-12 text-zinc-500">
            <MessageSquare className="h-8 w-8 mb-2 text-zinc-700" />
            <p className="text-sm">No conversation yet.</p>
          </div>
        )}

        {messages.map(msg => {
          if (consumedToolMsgIds.has(msg.id)) return null

          switch (msg.role) {
            case 'system':
              return <SystemMessage key={msg.id} msg={msg} />
            case 'user':
              return <UserMessage key={msg.id} msg={msg} />
            case 'assistant':
              return (
                <AssistantMessage
                  key={msg.id}
                  msg={msg}
                  followingToolResults={pairings.get(msg.id) ?? new Map()}
                />
              )
            case 'tool':
              return (
                <div key={msg.id} className="ml-4">
                  {msg.parts.map((part, idx) => {
                    if (part.kind !== 'tool_result') return null
                    return <ToolResultPart key={idx} toolName={part.toolName} content={part.content} />
                  })}
                </div>
              )
            default:
              return null
          }
        })}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
  )
}
