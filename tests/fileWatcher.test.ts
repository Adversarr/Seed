import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { JsonlEventStore } from '../src/infra/jsonlEventStore.js'
import { FileWatcher } from '../src/application/fileWatcher.js'
import { SYSTEM_ACTOR_ID } from '../src/domain/actor.js'

describe('FileWatcher', () => {
  test('pollOnce emits ArtifactChanged for create/modify/delete', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const store = new JsonlEventStore({
      eventsPath: join(dir, 'events.jsonl'),
      projectionsPath: join(dir, 'projections.jsonl')
    })
    store.ensureSchema()

    const watcher = new FileWatcher({
      store,
      baseDir: dir,
      includePaths: ['.'],
      includeExtensions: ['.tex']
    })

    writeFileSync(join(dir, 'a.tex'), 'hello', 'utf8')
    expect(watcher.pollOnce().changed).toBe(1)
    let events = store.readAll(0).filter((e) => e.type === 'ArtifactChanged')
    expect(events.length).toBe(1)
    expect((events[0] as any).payload.path).toBe('a.tex')
    expect((events[0] as any).payload.changeKind).toBe('created')
    expect((events[0] as any).payload.authorActorId).toBe(SYSTEM_ACTOR_ID)

    writeFileSync(join(dir, 'a.tex'), 'hello world', 'utf8')
    expect(watcher.pollOnce().changed).toBe(1)
    events = store.readAll(0).filter((e) => e.type === 'ArtifactChanged')
    expect(events.length).toBe(2)
    expect((events[1] as any).payload.changeKind).toBe('modified')

    unlinkSync(join(dir, 'a.tex'))
    expect(watcher.pollOnce().changed).toBe(1)
    events = store.readAll(0).filter((e) => e.type === 'ArtifactChanged')
    expect(events.length).toBe(3)
    expect((events[2] as any).payload.changeKind).toBe('deleted')

    rmSync(dir, { recursive: true, force: true })
  })

  test('snapshot is persisted and loaded on new instance', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coauthor-'))
    const store = new JsonlEventStore({
      eventsPath: join(dir, 'events.jsonl'),
      projectionsPath: join(dir, 'projections.jsonl')
    })
    store.ensureSchema()

    // Create first watcher and poll
    const watcher1 = new FileWatcher({
      store,
      baseDir: dir,
      includePaths: ['.'],
      includeExtensions: ['.tex']
    })

    writeFileSync(join(dir, 'a.tex'), 'hello', 'utf8')
    expect(watcher1.pollOnce().changed).toBe(1) // created

    // Verify snapshot file exists
    const snapshotPath = join(dir, '.coauthor', 'file-snapshot.json')
    expect(existsSync(snapshotPath)).toBe(true)

    const snapshotContent = JSON.parse(readFileSync(snapshotPath, 'utf8'))
    expect(snapshotContent['a.tex']).toBeDefined()

    // Create second watcher (simulates restart)
    const watcher2 = new FileWatcher({
      store,
      baseDir: dir,
      includePaths: ['.'],
      includeExtensions: ['.tex']
    })

    // Poll should return 0 changes because snapshot was loaded
    expect(watcher2.pollOnce().changed).toBe(0)

    // Events should still be only 1 (no duplicate created event)
    const events = store.readAll(0).filter((e) => e.type === 'ArtifactChanged')
    expect(events.length).toBe(1)

    rmSync(dir, { recursive: true, force: true })
  })
})

