import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, test } from 'vitest'
import { runCli } from '../src/interfaces/cli/run.js'
import type { IO } from '../src/interfaces/cli/io.js'
import { lockFilePath, writeLockFile, removeLockFile } from '../src/infrastructure/master/lockFile.js'

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
  const originalEnv = {
    provider: process.env.SEED_LLM_PROVIDER,
    apiKey: process.env.SEED_LLM_API_KEY,
    baseURL: process.env.SEED_LLM_BASE_URL,
    profiles: process.env.SEED_LLM_PROFILES_JSON,
  }

  afterEach(() => {
    if (originalEnv.provider === undefined) delete process.env.SEED_LLM_PROVIDER
    else process.env.SEED_LLM_PROVIDER = originalEnv.provider
    if (originalEnv.apiKey === undefined) delete process.env.SEED_LLM_API_KEY
    else process.env.SEED_LLM_API_KEY = originalEnv.apiKey
    if (originalEnv.baseURL === undefined) delete process.env.SEED_LLM_BASE_URL
    else process.env.SEED_LLM_BASE_URL = originalEnv.baseURL
    if (originalEnv.profiles === undefined) delete process.env.SEED_LLM_PROFILES_JSON
    else process.env.SEED_LLM_PROFILES_JSON = originalEnv.profiles
  })

  test('status reports not running for new workspace', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'seed-'))
    await writeFile(join(workspace, 'doc.tex'), 'hello\nworld\n', 'utf8')

    const io1 = createTestIO({})
    const code = await runCli({ argv: ['status'], defaultWorkspace: workspace, io: io1.io })
    expect(code).toBe(0)
    const out = io1.out.join('')
    expect(out).toContain(`Workspace: ${workspace}`)
    expect(out).toContain('Server: not running')
  })

  test('stop is idempotent when no lock exists', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'seed-'))

    const io1 = createTestIO({})
    const code = await runCli({ argv: ['stop'], defaultWorkspace: workspace, io: io1.io })
    expect(code).toBe(0)
    expect(io1.out.join('')).toContain('No server lock found.')
  })

  test('--workspace overrides defaultWorkspace', async () => {
    const workspace1 = await mkdtemp(join(tmpdir(), 'seed-'))
    const workspace2 = await mkdtemp(join(tmpdir(), 'seed-'))

    const io1 = createTestIO({})
    const code = await runCli({ argv: ['status', '--workspace', workspace2], defaultWorkspace: workspace1, io: io1.io })
    expect(code).toBe(0)
    expect(io1.out.join('')).toContain(`Workspace: ${workspace2}`)
  })

  test('status detects running server via lock + health', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'seed-'))
    const port = 33221
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 })) as typeof fetch

    const lockPath = lockFilePath(workspace)
    writeLockFile(lockPath, { pid: process.pid, port, token: 'test-token', startedAt: new Date().toISOString() })

    try {
      const io1 = createTestIO({})
      const code = await runCli({ argv: ['status'], defaultWorkspace: workspace, io: io1.io })
      expect(code).toBe(0)
      const out = io1.out.join('')
      expect(out).toContain('Server: running')
      expect(out).toContain(`http://127.0.0.1:${port}`)
    } finally {
      globalThis.fetch = originalFetch
      removeLockFile(lockPath)
    }
  }, 10_000)

  test('removed commands show a clear message', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'seed-'))
    const io1 = createTestIO({})
    const code = await runCli({ argv: ['task', 'list'], defaultWorkspace: workspace, io: io1.io })
    expect(code).toBe(1)
    expect(io1.err.join('')).toContain('removed')
  })

  test('unknown commands return exit code 1', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'seed-'))
    const io1 = createTestIO({})
    const code = await runCli({ argv: ['does-not-exist'], defaultWorkspace: workspace, io: io1.io })
    expect(code).toBe(1)
    expect(io1.err.join('').trim().length).toBeGreaterThan(0)
  })

  test('llm test connect succeeds for fake provider and checks fast/reasoning', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'seed-'))
    process.env.SEED_LLM_PROVIDER = 'fake'
    delete process.env.SEED_LLM_API_KEY
    delete process.env.SEED_LLM_BASE_URL
    delete process.env.SEED_LLM_PROFILES_JSON

    const io1 = createTestIO({})
    const code = await runCli({ argv: ['llm', 'test', 'connect'], defaultWorkspace: workspace, io: io1.io })
    expect(code).toBe(0)
    const out = io1.out.join('')
    expect(out).toContain('Provider: fake')
    expect(out).toContain('[ok] fast:')
    expect(out).toContain('[ok] reasoning:')
  })

  test('llm test websearch prints unsupported for fake provider', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'seed-'))
    process.env.SEED_LLM_PROVIDER = 'fake'
    delete process.env.SEED_LLM_API_KEY
    delete process.env.SEED_LLM_BASE_URL
    delete process.env.SEED_LLM_PROFILES_JSON

    const io1 = createTestIO({})
    const code = await runCli({ argv: ['llm', 'test', 'websearch'], defaultWorkspace: workspace, io: io1.io })
    expect(code).toBe(0)
    expect(io1.out.join('')).toContain('web_search is not supported for provider "fake"')
  })

  test('llm test websearch prints unsupported for openai provider', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'seed-'))
    process.env.SEED_LLM_PROVIDER = 'openai'
    process.env.SEED_LLM_API_KEY = 'test-key'
    delete process.env.SEED_LLM_BASE_URL
    delete process.env.SEED_LLM_PROFILES_JSON

    const io1 = createTestIO({})
    const code = await runCli({ argv: ['llm', 'test', 'websearch'], defaultWorkspace: workspace, io: io1.io })
    expect(code).toBe(0)
    expect(io1.out.join('')).toContain('web_search is not supported for provider "openai"')
  })

  test('llm test rejects invalid subcommand', async () => {
    const workspace = await mkdtemp(join(tmpdir(), 'seed-'))
    const io1 = createTestIO({})
    const code = await runCli({ argv: ['llm', 'test', 'nope'], defaultWorkspace: workspace, io: io1.io })
    expect(code).toBe(1)
  })
})
