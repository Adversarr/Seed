import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { runCli } from '../src/cli/run.js'
import type { IO } from '../src/cli/io.js'
import { createApp } from '../src/app/createApp.js'
import { CoAuthorServer } from '../src/infra/server.js'
import { lockFilePath, writeLockFile, removeLockFile } from '../src/infra/master/lockFile.js'

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
  test('status reports not running for new workspace', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'coauthor-'))
    await writeFile(join(workspace, 'doc.tex'), 'hello\nworld\n', 'utf8')

    const io1 = createTestIO({})
    const code = await runCli({ argv: ['status'], defaultWorkspace: workspace, io: io1.io })
    expect(code).toBe(0)
    const out = io1.out.join('')
    expect(out).toContain(`Workspace: ${workspace}`)
    expect(out).toContain('Server: not running')
  })

  test('stop is idempotent when no lock exists', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'coauthor-'))

    const io1 = createTestIO({})
    const code = await runCli({ argv: ['stop'], defaultWorkspace: workspace, io: io1.io })
    expect(code).toBe(0)
    expect(io1.out.join('')).toContain('No server lock found.')
  })

  test('--workspace overrides defaultWorkspace', async () => {
    const workspace1 = await mkdtemp(join(tmpdir(), 'coauthor-'))
    const workspace2 = await mkdtemp(join(tmpdir(), 'coauthor-'))

    const io1 = createTestIO({})
    const code = await runCli({ argv: ['status', '--workspace', workspace2], defaultWorkspace: workspace1, io: io1.io })
    expect(code).toBe(0)
    expect(io1.out.join('')).toContain(`Workspace: ${workspace2}`)
  })

  test('status detects running server via lock + health', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'coauthor-'))

    const app = await createApp({ baseDir: workspace })
    const server = new CoAuthorServer(app, { authToken: 'test-token' })
    await server.start()
    const addr = server.address
    if (!addr) throw new Error('Server did not start')

    const lockPath = lockFilePath(workspace)
    writeLockFile(lockPath, { pid: process.pid, port: addr.port, token: 'test-token', startedAt: new Date().toISOString() })

    try {
      const io1 = createTestIO({})
      const code = await runCli({ argv: ['status'], defaultWorkspace: workspace, io: io1.io })
      expect(code).toBe(0)
      const out = io1.out.join('')
      expect(out).toContain('Server: running')
      expect(out).toContain(`http://127.0.0.1:${addr.port}`)
    } finally {
      removeLockFile(lockPath)
      await server.stop()
    }
  })

  test('removed commands show a clear message', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'coauthor-'))
    const io1 = createTestIO({})
    const code = await runCli({ argv: ['task', 'list'], defaultWorkspace: workspace, io: io1.io })
    expect(code).toBe(1)
    expect(io1.err.join('')).toContain('removed')
  })

  test('unknown commands return exit code 1', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'coauthor-'))
    const io1 = createTestIO({})
    const code = await runCli({ argv: ['does-not-exist'], defaultWorkspace: workspace, io: io1.io })
    expect(code).toBe(1)
    expect(io1.err.join('').trim().length).toBeGreaterThan(0)
  })
})
