import { describe, expect, test } from 'vitest'
import { EventStore } from '../src/core/eventStore.js'
import { DatabaseSync } from 'node:sqlite'

describe('EventStore', () => {
  test('append/readStream keeps seq ordering', () => {
    const db = new DatabaseSync(':memory:')
    const store = new EventStore(db)
    store.ensureSchema()

    store.append('t1', [{ type: 'TaskCreated', payload: { taskId: 't1', title: 'hello' } }])
    store.append('t1', [{ type: 'ThreadOpened', payload: { taskId: 't1' } }])

    const events = store.readStream('t1', 1)
    expect(events.map((e) => e.seq)).toEqual([1, 2])
    expect(events[0]?.type).toBe('TaskCreated')
    expect(events[1]?.type).toBe('ThreadOpened')
  })

  test('readAll returns globally ordered events by id', () => {
    const db = new DatabaseSync(':memory:')
    const store = new EventStore(db)
    store.ensureSchema()

    store.append('a', [{ type: 'TaskCreated', payload: { taskId: 'a', title: 'A' } }])
    store.append('b', [{ type: 'TaskCreated', payload: { taskId: 'b', title: 'B' } }])

    const events = store.readAll(0)
    expect(events.length).toBe(2)
    expect(events[0]!.id).toBeLessThan(events[1]!.id)
  })
})
