import type { EventStore } from '../domain/ports/eventStore.js'
import type { StoredEvent } from '../domain/events.js'
import { SYSTEM_ACTOR_ID } from '../domain/actor.js'

type PendingProposal = {
  taskId: string
  proposalId: string
  baseRevision: string
}

export type DriftDetectorState = {
  pendingByPath: Record<string, PendingProposal[]>
  pendingByProposalId: Record<string, { path: string }>
}

const defaultState: DriftDetectorState = {
  pendingByPath: {},
  pendingByProposalId: {}
}

function removePending(state: DriftDetectorState, proposalId: string): void {
  const meta = state.pendingByProposalId[proposalId]
  if (!meta) return
  const path = meta.path
  delete state.pendingByProposalId[proposalId]
  const list = state.pendingByPath[path]
  if (!list) return
  const next = list.filter(p => p.proposalId !== proposalId)
  if (next.length === 0) delete state.pendingByPath[path]
  else state.pendingByPath[path] = next
}

export class DriftDetector {
  readonly #store: EventStore
  readonly #projectionName: string

  constructor(opts: { store: EventStore; projectionName?: string }) {
    this.#store = opts.store
    this.#projectionName = opts.projectionName ?? 'driftDetector'
  }

  processNewEvents(): { processed: number; emitted: number } {
    const proj = this.#store.getProjection<DriftDetectorState>(this.#projectionName, structuredClone(defaultState))
    const events = this.#store.readAll(proj.cursorEventId)
    if (events.length === 0) return { processed: 0, emitted: 0 }

    let emitted = 0
    const state = proj.state

    const handle = (e: StoredEvent) => {
      if (e.type === 'PatchProposed') {
        const baseRevision = e.payload.baseRevision
        if (!baseRevision) return
        const path = e.payload.targetPath
        const pending: PendingProposal = {
          taskId: e.payload.taskId,
          proposalId: e.payload.proposalId,
          baseRevision
        }
        state.pendingByPath[path] = [...(state.pendingByPath[path] ?? []), pending]
        state.pendingByProposalId[e.payload.proposalId] = { path }
        return
      }

      if (e.type === 'PatchRejected' || e.type === 'PatchApplied') {
        removePending(state, e.payload.proposalId)
        return
      }

      if (e.type === 'ArtifactChanged') {
        const path = e.payload.path
        const list = state.pendingByPath[path]
        if (!list || list.length === 0) return

        const mismatched = list.filter(p => p.baseRevision !== e.payload.newRevision)
        for (const p of mismatched) {
          this.#store.append(p.taskId, [
            {
              type: 'TaskNeedsRebase',
              payload: {
                taskId: p.taskId,
                affectedPaths: [path],
                reason: `ArtifactChanged: baseRevision mismatch for proposal ${p.proposalId}`,
                authorActorId: SYSTEM_ACTOR_ID
              }
            }
          ])
          emitted++
          removePending(state, p.proposalId)
        }
      }
    }

    for (const e of events) handle(e)
    const lastId = events.at(-1)!.id
    this.#store.saveProjection(this.#projectionName, lastId, state)
    return { processed: events.length, emitted }
  }
}

