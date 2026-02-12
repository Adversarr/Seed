/**
 * Tests for ActivityPage — event deduplication from initial fetch + real-time subscription.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ActivityPage } from '@/pages/ActivityPage'
import { eventBus } from '@/stores/eventBus'
import * as api from '@/services/api'
import type { StoredEvent } from '@/types'

vi.mock('@/services/api', () => ({
  api: {
    getEvents: vi.fn(),
    getAudit: vi.fn(),
  },
}))

vi.mock('@/stores', () => ({
  useConnectionStore: vi.fn((selector) => {
    const state = { status: 'connected' }
    return selector(state)
  }),
  eventBus: {
    on: vi.fn(() => () => {}),
    emit: vi.fn(),
    clear: vi.fn(),
  },
}))

function makeEvent(id: number, type: string, streamId: string = 'task-1', payload: Record<string, unknown> = {}): StoredEvent {
  return {
    id,
    streamId,
    seq: id,
    type: type as StoredEvent['type'],
    payload: { taskId: streamId, ...payload },
    createdAt: new Date().toISOString(),
  } as StoredEvent
}

function renderWithRouter(ui: React.ReactElement) {
  return render(
    <MemoryRouter>
      {ui}
    </MemoryRouter>
  )
}

describe('ActivityPage — event deduplication (Task 2)', () => {
  beforeEach(() => {
    eventBus.clear()
    vi.clearAllMocks()
    vi.mocked(api.api.getEvents).mockResolvedValue([])
    vi.mocked(api.api.getAudit).mockResolvedValue([])
  })

  it('fetches events on mount', async () => {
    renderWithRouter(<ActivityPage />)

    await waitFor(() => {
      expect(api.api.getEvents).toHaveBeenCalledWith(0)
    })
  })

  it('displays fetched events', async () => {
    const mockEvents = [
      makeEvent(1, 'TaskCreated', 'task-1', { title: 'Test Task' }),
    ]
    vi.mocked(api.api.getEvents).mockResolvedValue(mockEvents)

    renderWithRouter(<ActivityPage />)

    await waitFor(() => {
      expect(screen.getByText('TaskCreated')).toBeInTheDocument()
    })
  })

  it('deduplicates events when real-time event arrives before initial fetch completes', async () => {
    let resolveFetch: (value: StoredEvent[]) => void
    const fetchPromise = new Promise<StoredEvent[]>((resolve) => {
      resolveFetch = resolve
    })
    vi.mocked(api.api.getEvents).mockReturnValue(fetchPromise)

    const { container } = renderWithRouter(<ActivityPage />)

    const duplicateEvent = makeEvent(1, 'TaskCreated', 'task-1', { title: 'Test' })

    resolveFetch!([duplicateEvent])

    await waitFor(() => {
      expect(screen.getByText('TaskCreated')).toBeInTheDocument()
    })

    const eventCountElements = container.querySelectorAll('.text-\\[10px\\].text-zinc-500')
    const countElement = Array.from(eventCountElements).find((el) => el.textContent?.match(/^\d+$/))
    expect(countElement?.textContent).toBe('1')
  })

  it('shows event count badge accurately', async () => {
    const mockEvents = [
      makeEvent(1, 'TaskCreated', 'task-1'),
      makeEvent(2, 'TaskStarted', 'task-1'),
      makeEvent(3, 'TaskCompleted', 'task-1'),
    ]
    vi.mocked(api.api.getEvents).mockResolvedValue(mockEvents)

    const { container } = renderWithRouter(<ActivityPage />)

    await waitFor(() => {
      const eventCountElements = container.querySelectorAll('.text-\\[10px\\].text-zinc-500')
      const countElement = Array.from(eventCountElements).find((el) => el.textContent?.match(/^\d+$/))
      expect(countElement?.textContent).toBe('3')
    })
  })

  it('caps events at MAX_ACTIVITY_EVENTS (2000)', async () => {
    const manyEvents: StoredEvent[] = []
    for (let i = 1; i <= 2500; i++) {
      manyEvents.push(makeEvent(i, 'TaskInstructionAdded', `task-${i}`, { instruction: `inst-${i}` }))
    }
    vi.mocked(api.api.getEvents).mockResolvedValue(manyEvents)

    const { container } = renderWithRouter(<ActivityPage />)

    await waitFor(() => {
      const eventCountElements = container.querySelectorAll('.text-\\[10px\\].text-zinc-500')
      const countElement = Array.from(eventCountElements).find((el) => el.textContent?.match(/^\d+$/))
      const count = parseInt(countElement?.textContent ?? '0', 10)
      expect(count).toBeLessThanOrEqual(2000)
    })
  })

  it('shows loading state initially', async () => {
    let resolveFetch: (value: StoredEvent[]) => void
    vi.mocked(api.api.getEvents).mockReturnValue(new Promise((resolve) => {
      resolveFetch = resolve
    }))

    renderWithRouter(<ActivityPage />)

    expect(screen.getByText('Loading…')).toBeInTheDocument()

    resolveFetch!([])
    await waitFor(() => {
      expect(screen.queryByText('Loading…')).not.toBeInTheDocument()
    })
  })

  it('shows empty state when no events', async () => {
    vi.mocked(api.api.getEvents).mockResolvedValue([])

    renderWithRouter(<ActivityPage />)

    await waitFor(() => {
      expect(screen.getByText('No events yet.')).toBeInTheDocument()
    })
  })
})
