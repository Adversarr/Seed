/**
 * Thread/Patch Projection - tracks patch proposals and their application status.
 * Used by PatchService for querying patch states.
 */

import type { StoredEvent } from '../domain/events.js'

export type ThreadProjectionState = {
  threads: Record<
    string,
    {
      taskId: string
      proposals: Array<{
        proposalId: string
        targetPath: string
        patchText: string
        createdAt: string
        appliedAt: string | null
      }>
    }
  >
}

export const defaultThreadProjectionState: ThreadProjectionState = {
  threads: {}
}

/**
 * Thread projection reducer: tracks patch proposals and their lifecycle.
 */
export function reduceThreadProjection(state: ThreadProjectionState, event: StoredEvent): ThreadProjectionState {
  switch (event.type) {
    case 'PatchProposed': {
      const taskId = event.payload.taskId
      const current = state.threads[taskId] ?? { taskId, proposals: [] }
      if (current.proposals.some((p) => p.proposalId === event.payload.proposalId)) return state
      return {
        ...state,
        threads: {
          ...state.threads,
          [taskId]: {
            ...current,
            proposals: [
              ...current.proposals,
              {
                proposalId: event.payload.proposalId,
                targetPath: event.payload.targetPath,
                patchText: event.payload.patchText,
                createdAt: event.createdAt,
                appliedAt: null
              }
            ]
          }
        }
      }
    }
    case 'PatchApplied': {
      const taskId = event.payload.taskId
      const current = state.threads[taskId]
      if (!current) return state
      return {
        ...state,
        threads: {
          ...state.threads,
          [taskId]: {
            ...current,
            proposals: current.proposals.map((p) =>
              p.proposalId === event.payload.proposalId ? { ...p, appliedAt: event.payload.appliedAt } : p
            )
          }
        }
      }
    }
    default:
      return state
  }
}