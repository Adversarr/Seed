import { join } from 'node:path'
import { openSqliteDb } from '../infra/sqlite.js'
import { EventStore } from '../core/eventStore.js'

export type App = {
  baseDir: string
  dbPath: string
  store: EventStore
}

export function createApp(opts: { baseDir: string; dbPath?: string }): App {
  const baseDir = opts.baseDir
  const dbPath = opts.dbPath ?? join(baseDir, '.coauthor', 'coauthor.db')
  const db = openSqliteDb(dbPath)
  const store = new EventStore(db)
  store.ensureSchema()
  return { baseDir, dbPath, store }
}

