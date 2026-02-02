import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, relative, join, dirname } from 'node:path'
import type { EventStore } from '../domain/ports/eventStore.js'
import { SYSTEM_ACTOR_ID } from '../domain/actor.js'
import { computeRevision } from './revision.js'

type FileSnapshot = Map<string, string>

// Snapshot persistence format
type PersistedSnapshot = Record<string, string>

function shouldSkipDir(name: string): boolean {
  return name === '.git' || name === 'node_modules' || name === '.coauthor' || name === 'dist'
}

function collectFiles(opts: { baseDir: string; includePaths: string[]; includeExtensions: string[] }): string[] {
  const roots = opts.includePaths.map((p) => resolve(opts.baseDir, p))
  const files: string[] = []

  const visit = (abs: string) => {
    const entries = readdirSync(abs, { withFileTypes: true })
    for (const ent of entries) {
      if (ent.isDirectory()) {
        if (shouldSkipDir(ent.name)) continue
        visit(join(abs, ent.name))
        continue
      }
      if (!ent.isFile()) continue
      const full = join(abs, ent.name)
      if (opts.includeExtensions.length > 0 && !opts.includeExtensions.some((ext) => full.endsWith(ext))) continue
      files.push(full)
    }
  }

  for (const root of roots) visit(root)
  return files
}

function toRelPath(baseDir: string, absPath: string): string {
  const rel = relative(baseDir, absPath)
  return rel.split('\\').join('/')
}

export class FileWatcher {
  readonly #store: EventStore
  readonly #baseDir: string
  readonly #includePaths: string[]
  readonly #includeExtensions: string[]
  readonly #snapshotPath: string
  #snapshot: FileSnapshot = new Map()

  constructor(opts: { store: EventStore; baseDir: string; includePaths: string[]; includeExtensions: string[] }) {
    this.#store = opts.store
    this.#baseDir = opts.baseDir
    this.#includePaths = opts.includePaths
    this.#includeExtensions = opts.includeExtensions
    this.#snapshotPath = join(opts.baseDir, '.coauthor', 'file-snapshot.json')

    // Load persisted snapshot on construction
    this.#loadSnapshot()
  }

  #loadSnapshot(): void {
    if (!existsSync(this.#snapshotPath)) return
    try {
      const raw = readFileSync(this.#snapshotPath, 'utf8')
      const data = JSON.parse(raw) as PersistedSnapshot
      this.#snapshot = new Map(Object.entries(data))
    } catch {
      // If file is corrupted, start fresh
      this.#snapshot = new Map()
    }
  }

  #saveSnapshot(): void {
    const data: PersistedSnapshot = Object.fromEntries(this.#snapshot)
    mkdirSync(dirname(this.#snapshotPath), { recursive: true })
    writeFileSync(this.#snapshotPath, JSON.stringify(data, null, 2))
  }

  pollOnce(): { changed: number } {
    const current: FileSnapshot = new Map()
    const absFiles = collectFiles({
      baseDir: this.#baseDir,
      includePaths: this.#includePaths,
      includeExtensions: this.#includeExtensions
    })

    for (const absPath of absFiles) {
      const text = readFileSync(absPath, 'utf8')
      const rel = toRelPath(this.#baseDir, absPath)
      current.set(rel, computeRevision(text))
    }

    let changed = 0
    const emptyRev = computeRevision('')

    for (const [rel, newRev] of current) {
      const oldRev = this.#snapshot.get(rel)
      if (!oldRev) {
        this.#store.append(`artifact:${rel}`, [
          {
            type: 'ArtifactChanged',
            payload: {
              path: rel,
              oldRevision: undefined,
              newRevision: newRev,
              changeKind: 'created',
              authorActorId: SYSTEM_ACTOR_ID
            }
          }
        ])
        changed++
        continue
      }
      if (oldRev !== newRev) {
        this.#store.append(`artifact:${rel}`, [
          {
            type: 'ArtifactChanged',
            payload: {
              path: rel,
              oldRevision: oldRev,
              newRevision: newRev,
              changeKind: 'modified',
              authorActorId: SYSTEM_ACTOR_ID
            }
          }
        ])
        changed++
      }
    }

    for (const [rel, oldRev] of this.#snapshot) {
      if (current.has(rel)) continue
      this.#store.append(`artifact:${rel}`, [
        {
          type: 'ArtifactChanged',
          payload: {
            path: rel,
            oldRevision: oldRev,
            newRevision: emptyRev,
            changeKind: 'deleted',
            authorActorId: SYSTEM_ACTOR_ID
          }
        }
      ])
      changed++
    }

    this.#snapshot = current

    // Debounce: only persist when there were changes
    if (changed > 0) {
      this.#saveSnapshot()
    }

    return { changed }
  }
}

