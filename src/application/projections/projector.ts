import type { StoredEvent } from '../../core/events/events.js'
import type { EventStore } from '../../core/ports/eventStore.js'

// Projection reducer: fold event into state
export type ProjectionReducer<TState> = (state: TState, event: StoredEvent) => TState

// Run projection: load cursor → read events → fold → save cursor
export async function runProjection<TState>(opts: {
  store: EventStore
  name: string
  defaultState: TState
  reduce: ProjectionReducer<TState>
}): Promise<TState> {
  const { store, name, defaultState, reduce } = opts
  const { cursorEventId, state } = await store.getProjection(name, defaultState)
  const events = await store.readAll(cursorEventId)

  if (events.length === 0) return state

  let nextState = state
  for (const event of events) {
    nextState = reduce(nextState, event)
  }

  const lastEventId = events[events.length - 1]?.id ?? cursorEventId
  await store.saveProjection(name, lastEventId, nextState)
  return nextState
}
