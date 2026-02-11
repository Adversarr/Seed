import React from 'react'
import { render } from 'ink-testing-library'
import { describe, it, expect, vi } from 'vitest'
import { InteractionPanel } from '../../src/interfaces/tui/components/InteractionPanel.js'
import type { UserInteractionRequestedPayload } from '../../src/core/events/events.js'

describe('InteractionPanel', () => {
  it('renders Diff view correctly', () => {
    const interaction: UserInteractionRequestedPayload = {
      interactionId: '1',
      taskId: 't1',
      kind: 'Confirm',
      purpose: 'confirm_risky_action',
      authorActorId: 'agent',
      display: {
        title: 'Confirm',
        description: 'Check diff',
        contentKind: 'Diff',
        content: '--- a\n+++ b\n-old\n+new'
      },
      options: [
        { id: 'approve', label: 'Approve' },
        { id: 'reject', label: 'Reject' }
      ]
    }

    const onSubmit = vi.fn()
    const { lastFrame } = render(<InteractionPanel pendingInteraction={interaction} onSubmit={onSubmit} />)

    expect(lastFrame()).toContain('[INTERACTION] Confirm')
    expect(lastFrame()).toContain('Check diff')
    expect(lastFrame()).toContain('old') // red
    expect(lastFrame()).toContain('new') // green
    expect(lastFrame()).toContain('> Approve')
  })
})
