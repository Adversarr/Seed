import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export function openSqliteDb(dbPath: string): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true })
  return new DatabaseSync(dbPath)
}
