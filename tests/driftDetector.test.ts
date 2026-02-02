import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { JsonlEventStore } from '../src/infra/jsonlEventStore.js'
import { DriftDetector } from '../src/application/driftDetector.js'
import { computeRevision } from '../src/application/revision.js'
import { DEFAULT_USER_ACTOR_ID, SYSTEM_ACTOR_ID } from '../src/domain/actor.js'

describe('DriftDetector', () => {
  test('emits TaskNeedsRebase when ArtifactChanged mismatches proposal baseRevision', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const store = new JsonlEventStore({
      eventsPath: join(dir, 'events.jsonl'),
      projectionsPath: join(dir, 'projections.jsonl')
    })
    store.ensureSchema()

    const detector = new DriftDetector({ store })
    const baseRevision = computeRevision('v1')
    const newRevision = computeRevision('v2')

    store.append('t1', [
      {
        type: 'PatchProposed',
        payload: {
          taskId: 't1',
          proposalId: 'p1',
          targetPath: 'a.tex',
          patchText: 'diff',
          baseRevision,
          authorActorId: DEFAULT_USER_ACTOR_ID
        }
      }
    ])

    store.append('artifact:a.tex', [
      {
        type: 'ArtifactChanged',
        payload: {
          path: 'a.tex',
          oldRevision: baseRevision,
          newRevision,
          changeKind: 'modified',
          authorActorId: SYSTEM_ACTOR_ID
        }
      }
    ])

    const res = detector.processNewEvents()
    expect(res.emitted).toBe(1)

    const taskEvents = store.readStream('t1', 1)
    expect(taskEvents.some((e) => e.type === 'TaskNeedsRebase')).toBe(true)

    const res2 = detector.processNewEvents()
    expect(res2.emitted).toBe(0)

    rmSync(dir, { recursive: true, force: true })
  })
})

