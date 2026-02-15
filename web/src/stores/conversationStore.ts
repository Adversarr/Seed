/**
 * Conversation store — builds a structured conversation view from LLM messages.
 *
 * Fetches LLM conversation history per task from the backend ConversationStore.
 * Preserves interleaved output order (reasoning → tool → reasoning → content)
 * via a `parts` array on each message.
 */

import { create } from 'zustand'
import { api } from '@/services/api'
import type { LLMMessage, UiEvent } from '@/types'
import { eventBus } from './eventBus'

// ── Conversation message types (preserve interleaved order) ────────────

export type MessageRole = 'user' | 'assistant' | 'system' | 'tool'

export type MessagePart =
  | { kind: 'text'; content: string }
  | { kind: 'reasoning'; content: string }
  | { kind: 'tool_call'; toolCallId: string; toolName: string; arguments: Record<string, unknown> }
  | { kind: 'tool_result'; toolCallId: string; toolName?: string; content: string }

export interface ConversationMessage {
  id: string
  role: MessageRole
  parts: MessagePart[]
  timestamp: string
}

const EMPTY_MESSAGES: ConversationMessage[] = []

// ── Store ──────────────────────────────────────────────────────────────

interface ConversationState {
  /** Task ID → conversation messages */
  conversations: Record<string, ConversationMessage[]>
  /** Currently loading task IDs */
  loadingTasks: Set<string>

  /** Fetch conversation history for a task from the conversation API. */
  fetchConversation: (taskId: string, opts?: { preserveLive?: boolean }) => Promise<void>

  /** Get messages for a task. */
  getMessages: (taskId: string) => ConversationMessage[]

  /** Clear conversation for a task. */
  clearConversation: (taskId: string) => void
}

let messageIndex = 0

function generateMessageId(): string {
  return `msg-${Date.now()}-${++messageIndex}`
}

function generateLiveMessageId(): string {
  return `live-${Date.now()}-${++messageIndex}`
}

function isLiveMessage(message: ConversationMessage): boolean {
  return message.id.startsWith('live-')
}

function getTaskIdFromUiEvent(event: UiEvent): string | null {
  const payload = event.payload as Record<string, unknown> | undefined
  const taskId = payload?.taskId
  return typeof taskId === 'string' && taskId.length > 0 ? taskId : null
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function transformLLMMessage(message: LLMMessage): ConversationMessage {
  const timestamp = new Date().toISOString()
  const id = generateMessageId()

  switch (message.role) {
    case 'system':
      return {
        id,
        role: 'system',
        parts: [{ kind: 'text', content: message.content }],
        timestamp,
      }

    case 'user':
      return {
        id,
        role: 'user',
        parts: [{ kind: 'text', content: message.content }],
        timestamp,
      }

    case 'assistant': {
      const parts: MessagePart[] = []

      // Prefer the ordered `parts` array when available (preserves true interleaving)
      if (message.parts && message.parts.length > 0) {
        for (const p of message.parts) {
          switch (p.kind) {
            case 'text':
              parts.push({ kind: 'text', content: p.content })
              break
            case 'reasoning':
              parts.push({ kind: 'reasoning', content: p.content })
              break
            case 'tool_call':
              parts.push({
                kind: 'tool_call',
                toolCallId: p.toolCallId,
                toolName: p.toolName,
                arguments: p.arguments,
              })
              break
          }
        }
      } else {
        // Legacy fallback: build parts from flat fields (reasoning → toolCalls → text)
        if (message.reasoning) {
          parts.push({ kind: 'reasoning', content: message.reasoning })
        }

        if (message.toolCalls && message.toolCalls.length > 0) {
          for (const toolCall of message.toolCalls) {
            parts.push({
              kind: 'tool_call',
              toolCallId: toolCall.toolCallId,
              toolName: toolCall.toolName,
              arguments: toolCall.arguments,
            })
          }
        }

        if (message.content) {
          parts.push({ kind: 'text', content: message.content })
        }
      }

      return { id, role: 'assistant', parts, timestamp }
    }

    case 'tool':
      return {
        id,
        role: 'tool',
        parts: [{
          kind: 'tool_result',
          toolCallId: message.toolCallId,
          toolName: message.toolName,
          content: message.content,
        }],
        timestamp,
      }
  }
}

export const useConversationStore = create<ConversationState>((set, get) => ({
  conversations: {},
  loadingTasks: new Set(),

  fetchConversation: async (taskId, opts) => {
    const preserveLive = opts?.preserveLive ?? true
    set((state) => {
      const loading = new Set(state.loadingTasks)
      loading.add(taskId)
      if (state.conversations[taskId]) {
        return { loadingTasks: loading }
      }
      // Create an empty entry immediately so live UiEvents during fetch
      // can be appended instead of being dropped.
      return {
        loadingTasks: loading,
        conversations: { ...state.conversations, [taskId]: [] },
      }
    })

    try {
      const llmMessages = await api.getConversation(taskId)
      const messages = llmMessages.map(transformLLMMessage)
      set((state) => {
        const liveMessages = preserveLive
          ? (state.conversations[taskId] ?? []).filter(isLiveMessage)
          : []
        const done = new Set(state.loadingTasks)
        done.delete(taskId)
        return {
          conversations: { ...state.conversations, [taskId]: [...messages, ...liveMessages] },
          loadingTasks: done,
        }
      })
    } catch {
      set((state) => {
        const done = new Set(state.loadingTasks)
        done.delete(taskId)
        return { loadingTasks: done }
      })
    }
  },

  getMessages: (taskId) => get().conversations[taskId] ?? EMPTY_MESSAGES,

  clearConversation: (taskId) => {
    const conversations = { ...get().conversations }
    delete conversations[taskId]
    set({ conversations })
  },
}))

let conversationUnsub: (() => void) | null = null
let conversationUiUnsub: (() => void) | null = null

function appendLiveAssistantPart(taskId: string, part: Exclude<MessagePart, { kind: 'tool_result' }>): void {
  useConversationStore.setState((state) => {
    const existing = state.conversations[taskId]
    if (!existing) return state

    const messages = [...existing]
    const last = messages[messages.length - 1]
    const now = new Date().toISOString()

    if (last && last.role === 'assistant' && isLiveMessage(last)) {
      const parts = [...last.parts]
      const lastPart = parts[parts.length - 1]

      // Merge only consecutive text/reasoning chunks for readability.
      if (
        (part.kind === 'text' || part.kind === 'reasoning') &&
        lastPart &&
        lastPart.kind === part.kind
      ) {
        parts[parts.length - 1] = { ...lastPart, content: lastPart.content + part.content }
      } else {
        parts.push(part)
      }

      messages[messages.length - 1] = { ...last, parts, timestamp: now }
    } else {
      messages.push({
        id: generateLiveMessageId(),
        role: 'assistant',
        parts: [part],
        timestamp: now,
      })
    }

    return {
      conversations: { ...state.conversations, [taskId]: messages },
    }
  })
}

function appendLiveToolResult(taskId: string, toolCallId: string, toolName: string, content: string): void {
  useConversationStore.setState((state) => {
    const existing = state.conversations[taskId]
    if (!existing) return state

    const newMessage: ConversationMessage = {
      id: generateLiveMessageId(),
      role: 'tool',
      parts: [{ kind: 'tool_result', toolCallId, toolName, content }],
      timestamp: new Date().toISOString(),
    }
    return {
      conversations: { ...state.conversations, [taskId]: [...existing, newMessage] },
    }
  })
}

function handleUiConversationEvent(event: UiEvent): void {
  const taskId = getTaskIdFromUiEvent(event)
  if (!taskId) return

  if (event.type === 'agent_output') {
    if (event.payload.kind === 'reasoning') {
      appendLiveAssistantPart(taskId, { kind: 'reasoning', content: event.payload.content })
      return
    }
    if (event.payload.kind === 'text') {
      appendLiveAssistantPart(taskId, { kind: 'text', content: event.payload.content })
      return
    }
    if (event.payload.kind === 'error') {
      appendLiveAssistantPart(taskId, { kind: 'text', content: `Error: ${event.payload.content}` })
    }
    return
  }

  if (event.type === 'stream_delta') {
    const part = event.payload.kind === 'reasoning'
      ? { kind: 'reasoning', content: event.payload.content } as const
      : { kind: 'text', content: event.payload.content } as const
    appendLiveAssistantPart(taskId, part)
    return
  }

  if (event.type === 'tool_call_start') {
    appendLiveAssistantPart(taskId, {
      kind: 'tool_call',
      toolCallId: event.payload.toolCallId,
      toolName: event.payload.toolName,
      arguments: event.payload.arguments,
    })
    return
  }

  if (event.type === 'tool_call_end') {
    const content = stringifyUnknown(event.payload.output)
    appendLiveToolResult(taskId, event.payload.toolCallId, event.payload.toolName, content)
  }
}

export function registerConversationSubscriptions(): void {
  if (conversationUnsub || conversationUiUnsub) return
  conversationUnsub = eventBus.on('domain-event', (event) => {
    const taskId = (event.payload as Record<string, unknown>).taskId as string | undefined
    if (!taskId) return

    if (event.type === 'TaskInstructionAdded') {
      const instruction = (event.payload as Record<string, unknown>).instruction as string | undefined
      if (!instruction) return

      useConversationStore.setState((state) => {
        const existing = state.conversations[taskId]
        if (!existing) return state

        const newMessage: ConversationMessage = {
          id: generateMessageId(),
          role: 'user',
          parts: [{ kind: 'text', content: instruction }],
          timestamp: event.createdAt,
        }

        return {
          conversations: { ...state.conversations, [taskId]: [...existing, newMessage] },
        }
      })
    }

    if (event.type === 'TaskCompleted' || event.type === 'TaskFailed') {
      // Reconcile with persisted canonical history on terminal events.
      void useConversationStore.getState().fetchConversation(taskId, { preserveLive: false })
    }
  })
  conversationUiUnsub = eventBus.on('ui-event', (event) => {
    handleUiConversationEvent(event)
  })
}

export function unregisterConversationSubscriptions(): void {
  if (conversationUnsub) {
    conversationUnsub()
    conversationUnsub = null
  }
  if (conversationUiUnsub) {
    conversationUiUnsub()
    conversationUiUnsub = null
  }
}

registerConversationSubscriptions()
