import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { runCli } from '../src/cli/run.js'
import type { IO } from '../src/cli/io.js'

function createTestIO(opts: { stdinText?: string }) {
  const out: string[] = []
  const err: string[] = []
  const io: IO = {
    readStdin: async () => opts.stdinText ?? '',
    stdout: (t) => out.push(t),
    stderr: (t) => err.push(t)
  }
  return { io, out, err }
}

describe('CLI smoke', () => {
  test('create task -> list tasks -> replay log', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'coauthor-'))
    await writeFile(join(baseDir, 'doc.tex'), 'hello\nworld\n', 'utf8')

    // Create a task
    const io1 = createTestIO({})
    await runCli({ argv: ['task', 'create', 'Hello'], baseDir, io: io1.io })
    const taskId = io1.out.join('').trim()
    expect(taskId.length).toBeGreaterThan(5)

    // List tasks
    const io2 = createTestIO({})
    await runCli({ argv: ['task', 'list'], baseDir, io: io2.io })
    expect(io2.out.join('')).toContain(taskId)
    expect(io2.out.join('')).toContain('Hello')

    // Replay log
    const io3 = createTestIO({})
    await runCli({ argv: ['log', 'replay', taskId], baseDir, io: io3.io })
    const replay = io3.out.join('')
    expect(replay).toMatch(/TaskCreated/)
  })

  test('task create --file/--lines works correctly', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'coauthor-'))
    await writeFile(join(baseDir, 'doc.tex'), 'hello\nworld\n', 'utf8')

    const io1 = createTestIO({})
    await runCli({
      argv: ['task', 'create', 'Improve', '--file', 'doc.tex', '--lines', '1-2'],
      baseDir,
      io: io1.io
    })
    const taskId = io1.out.join('').trim()
    expect(taskId.length).toBeGreaterThan(5)

    // Verify the task was created with artifact refs
    const io2 = createTestIO({})
    await runCli({ argv: ['log', 'replay', taskId], baseDir, io: io2.io })
    const replay = io2.out.join('')
    expect(replay).toMatch(/TaskCreated/)
    expect(replay).toContain('file_range')
    expect(replay).toContain('doc.tex')
  })

  test('interact pending shows no interactions for new task', async () => {
    const baseDir = await mkdtemp(join(tmpdir(), 'coauthor-'))

    // Create a task
    const io1 = createTestIO({})
    await runCli({ argv: ['task', 'create', 'Test task'], baseDir, io: io1.io })

    // Check pending interactions (should be none for new task)
    const io2 = createTestIO({})
    await runCli({ argv: ['interact', 'pending'], baseDir, io: io2.io })
    expect(io2.out.join('')).toContain('No pending interactions')
  })
})
