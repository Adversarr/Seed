/**
 * Application Layer - Interaction Service
 *
 * Handles UIP (Universal Interaction Protocol) events.
 * Responsible for creating interaction requests and processing responses.
 */

import { nanoid } from 'nanoid'
import type { EventStore } from '../domain/ports/eventStore.js'
import type {
  UserInteractionRequestedPayload,
  UserInteractionRespondedPayload,
  InteractionKind,
  InteractionPurpose,
  InteractionDisplay,
  InteractionOption,
  InteractionValidation
} from '../domain/events.js'
import { DEFAULT_USER_ACTOR_ID } from '../domain/actor.js'

// ============================================================================
// Types
// ============================================================================

export type InteractionRequest = {
  kind: InteractionKind
  purpose: InteractionPurpose
  display: InteractionDisplay
  options?: InteractionOption[]
  validation?: InteractionValidation
}

export type InteractionResponse = {
  selectedOptionId?: string
  inputValue?: string
  comment?: string
}

// ============================================================================
// Interaction Service
// ============================================================================

export class InteractionService {
  readonly #store: EventStore
  readonly #currentActorId: string

  constructor(store: EventStore, currentActorId: string = DEFAULT_USER_ACTOR_ID) {
    this.#store = store
    this.#currentActorId = currentActorId
  }

  /**
   * Request an interaction from the user.
   * Emits UserInteractionRequested event and returns the interactionId.
   */
  requestInteraction(
    taskId: string,
    request: InteractionRequest,
    authorActorId?: string
  ): { interactionId: string } {
    const interactionId = `ui_${nanoid(12)}`
    
    this.#store.append(taskId, [
      {
        type: 'UserInteractionRequested',
        payload: {
          interactionId,
          taskId,
          kind: request.kind,
          purpose: request.purpose,
          display: request.display,
          options: request.options,
          validation: request.validation,
          authorActorId: authorActorId ?? this.#currentActorId
        }
      }
    ])

    return { interactionId }
  }

  /**
   * Submit a response to an interaction.
   * Emits UserInteractionResponded event.
   */
  respondToInteraction(
    taskId: string,
    interactionId: string,
    response: InteractionResponse
  ): void {
    this.#store.append(taskId, [
      {
        type: 'UserInteractionResponded',
        payload: {
          interactionId,
          taskId,
          selectedOptionId: response.selectedOptionId,
          inputValue: response.inputValue,
          comment: response.comment,
          authorActorId: this.#currentActorId
        }
      }
    ])
  }

  /**
   * Get the pending interaction for a task (if any).
   * Returns the most recent unanswered interaction request.
   */
  getPendingInteraction(taskId: string): UserInteractionRequestedPayload | null {
    const events = this.#store.readStream(taskId)
    
    // Build a set of responded interaction IDs
    const respondedIds = new Set<string>()
    for (const event of events) {
      if (event.type === 'UserInteractionResponded') {
        respondedIds.add(event.payload.interactionId)
      }
    }

    // Find the last unanswered request
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]
      if (event?.type === 'UserInteractionRequested') {
        if (!respondedIds.has(event.payload.interactionId)) {
          return event.payload
        }
      }
    }

    return null
  }

  /**
   * Get the response for a specific interaction (if any).
   */
  getInteractionResponse(
    taskId: string,
    interactionId: string
  ): UserInteractionRespondedPayload | null {
    const events = this.#store.readStream(taskId)
    
    for (const event of events) {
      if (
        event.type === 'UserInteractionResponded' &&
        event.payload.interactionId === interactionId
      ) {
        return event.payload
      }
    }

    return null
  }

  /**
   * Wait for a response to an interaction.
   * Polls the event store until a response is found or timeout.
   */
  async waitForResponse(
    taskId: string,
    interactionId: string,
    opts?: { timeoutMs?: number; pollIntervalMs?: number }
  ): Promise<UserInteractionRespondedPayload | null> {
    const timeoutMs = opts?.timeoutMs ?? 300000 // 5 minutes default
    const pollIntervalMs = opts?.pollIntervalMs ?? 100

    const startTime = Date.now()
    
    while (Date.now() - startTime < timeoutMs) {
      const response = this.getInteractionResponse(taskId, interactionId)
      if (response) {
        return response
      }
      
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
    }

    return null
  }
}
