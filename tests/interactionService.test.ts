import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { join } from 'node:path'
import { rmSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { nanoid } from 'nanoid'
import { JsonlEventStore } from '../src/infra/jsonlEventStore.js'
import { InteractionService } from '../src/application/interactionService.js'

describe('InteractionService', () => {
  let baseDir: string
  let eventsPath: string

  beforeEach(() => {
    baseDir = join(tmpdir(), `coauthor-interaction-${nanoid()}`)
    mkdirSync(baseDir, { recursive: true })
    eventsPath = join(baseDir, 'events.jsonl')
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('should request and respond to interactions', () => {
    const store = new JsonlEventStore({ eventsPath })
    store.ensureSchema()
    const service = new InteractionService(store)
    const taskId = 't1'

    // Request
    const { interactionId } = service.requestInteraction(taskId, {
      kind: 'Confirm',
      purpose: 'confirm_risky_action',
      display: { title: 'Confirm' }
    })

    // Get Pending
    const pending = service.getPendingInteraction(taskId)
    expect(pending).not.toBeNull()
    expect(pending?.interactionId).toBe(interactionId)

    // Respond
    service.respondToInteraction(taskId, interactionId, { selectedOptionId: 'ok' })

    // Get Pending again (should be null)
    const pendingAfter = service.getPendingInteraction(taskId)
    expect(pendingAfter).toBeNull()

    // Get Response
    const response = service.getInteractionResponse(taskId, interactionId)
    expect(response).not.toBeNull()
    expect(response?.selectedOptionId).toBe('ok')
  })

  it('should wait for response', async () => {
    const store = new JsonlEventStore({ eventsPath })
    store.ensureSchema()
    const service = new InteractionService(store)
    const taskId = 't1'
    const { interactionId } = service.requestInteraction(taskId, {
      kind: 'Input',
      purpose: 'request_info',
      display: { title: 'Input' }
    })

    // Simulate async response
    setTimeout(() => {
      service.respondToInteraction(taskId, interactionId, { inputValue: 'hello' })
    }, 50)

    const response = await service.waitForResponse(taskId, interactionId, { pollIntervalMs: 10 })
    expect(response).not.toBeNull()
    expect(response?.inputValue).toBe('hello')
  })
})
