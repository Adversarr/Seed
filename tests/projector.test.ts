import { DatabaseSync } from 'node:sqlite'
import { describe, expect, test } from 'vitest'
import { EventStore } from '../src/core/eventStore.js'
import { runProjection } from '../src/core/projector.js'
import { defaultTasksProjectionState, reduceTasksProjection } from '../src/core/projections.js'

describe('Projection', () => {
  test('tasks projection advances cursor and is idempotent', async () => {
    const db = new DatabaseSync(':memory:')
    const store = new EventStore(db)
    store.ensureSchema()

    store.append('t1', [{ type: 'TaskCreated', payload: { taskId: 't1', title: 'T1' } }])
    store.append('t2', [{ type: 'TaskCreated', payload: { taskId: 't2', title: 'T2' } }])

    const s1 = await runProjection({
      store,
      name: 'tasks',
      defaultState: defaultTasksProjectionState,
      reduce: reduceTasksProjection
    })
    expect(s1.tasks.map((t) => t.taskId).sort()).toEqual(['t1', 't2'])

    const s2 = await runProjection({
      store,
      name: 'tasks',
      defaultState: defaultTasksProjectionState,
      reduce: reduceTasksProjection
    })
    expect(s2.tasks.length).toBe(2)
  })
})
