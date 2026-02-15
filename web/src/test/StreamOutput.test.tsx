/**
 * StreamOutput replay transcript tests.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StreamOutput } from '@/components/panels/StreamOutput'

type TestConversationMessage = {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  timestamp: string
  parts: Array<
    | { kind: 'text'; content: string }
    | { kind: 'reasoning'; content: string }
    | { kind: 'tool_call'; toolCallId: string; toolName: string; arguments: Record<string, unknown> }
    | { kind: 'tool_result'; toolCallId: string; toolName?: string; content: string }
  >
}

const mockFetchConversation = vi.fn()
let mockMessages: TestConversationMessage[] = []
let mockLoading = false

vi.mock('@/stores/conversationStore', () => ({
  useConversationStore: vi.fn((selector: (state: {
    getMessages: (taskId: string) => TestConversationMessage[]
    loadingTasks: Set<string>
    fetchConversation: (taskId: string) => Promise<void>
  }) => unknown) => selector({
    getMessages: () => mockMessages,
    loadingTasks: mockLoading ? new Set(['task-1']) : new Set<string>(),
    fetchConversation: mockFetchConversation,
  })),
}))

// Regression guard: output transcript must not consume stream store data.
vi.mock('@/stores/streamStore', () => {
  throw new Error('StreamOutput should not import streamStore in replay-only mode')
})

describe('StreamOutput replay transcript', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockMessages = []
    mockLoading = false
    mockFetchConversation.mockResolvedValue(undefined)
  })

  it('renders assistant text/reasoning and tool call/result in chronological order', () => {
    mockMessages = [
      {
        id: 'm-user',
        role: 'user',
        timestamp: new Date().toISOString(),
        parts: [{ kind: 'text', content: 'Please summarize.' }],
      },
      {
        id: 'm-assistant',
        role: 'assistant',
        timestamp: new Date().toISOString(),
        parts: [
          { kind: 'reasoning', content: 'I should condense the content.' },
          { kind: 'tool_call', toolCallId: 'tc-1', toolName: 'search_docs', arguments: { query: 'paper' } },
          { kind: 'text', content: 'Final replay answer.' },
        ],
      },
      {
        id: 'm-tool',
        role: 'tool',
        timestamp: new Date().toISOString(),
        parts: [{ kind: 'tool_result', toolCallId: 'tc-1', toolName: 'search_docs', content: 'search results' }],
      },
    ]

    render(<StreamOutput taskId="task-1" />)

    expect(mockFetchConversation).toHaveBeenCalledWith('task-1')
    expect(screen.getByText('User')).toBeInTheDocument()
    expect(screen.getByText('Assistant Reasoning')).toBeInTheDocument()
    expect(screen.getByText('Assistant')).toBeInTheDocument()
    expect(screen.getByText('Tool Call: search_docs')).toBeInTheDocument()
    expect(screen.getByText('Tool Result: search_docs')).toBeInTheDocument()
    expect(screen.getByText('Please summarize.')).toBeInTheDocument()
    expect(screen.getByText('I should condense the content.')).toBeInTheDocument()
    expect(screen.getByText('Final replay answer.')).toBeInTheDocument()
    expect(screen.getByText(/"query": "paper"/)).toBeInTheDocument()
    expect(screen.getByText('search results')).toBeInTheDocument()
  })

  it('shows empty state when conversation is empty', () => {
    mockMessages = []
    mockLoading = false

    render(<StreamOutput taskId="task-1" />)

    expect(screen.getByText('No output transcript available yet.')).toBeInTheDocument()
  })

  it('renders persisted content once across rerenders', () => {
    mockMessages = [
      {
        id: 'm-assistant',
        role: 'assistant',
        timestamp: new Date().toISOString(),
        parts: [{ kind: 'text', content: 'Stable persisted answer' }],
      },
    ]

    const { rerender } = render(<StreamOutput taskId="task-1" />)
    expect(screen.getAllByText('Stable persisted answer')).toHaveLength(1)

    rerender(<StreamOutput taskId="task-1" />)
    expect(screen.getAllByText('Stable persisted answer')).toHaveLength(1)
  })
})
