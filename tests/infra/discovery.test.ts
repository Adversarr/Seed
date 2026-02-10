/**
 * Tests for master/client discovery.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer, type Server } from 'node:http'
import { discoverMaster } from '../../src/infra/master/discovery.js'
import { writeLockFile, lockFilePath } from '../../src/infra/master/lockFile.js'

describe('Master Discovery', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'coauthor-disc-test-'))
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns master when no lock file exists', async () => {
    const result = await discoverMaster(tmpDir)
    expect(result).toEqual({ mode: 'master' })
  })

  it('returns master when lock file has dead PID', async () => {
    writeLockFile(lockFilePath(tmpDir), {
      pid: 99999999, // Dead PID
      port: 3000,
      token: 'tok',
      startedAt: new Date().toISOString(),
    })
    const result = await discoverMaster(tmpDir)
    expect(result).toEqual({ mode: 'master' })
  })

  it('returns client when lock file points to live server', async () => {
    // Start a minimal HTTP server
    const server = createServer((_, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'ok' }))
    })

    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address() as { port: number }

    try {
      writeLockFile(lockFilePath(tmpDir), {
        pid: process.pid,
        port: addr.port,
        token: 'my-token',
        startedAt: new Date().toISOString(),
      })

      const result = await discoverMaster(tmpDir)
      expect(result).toEqual({ mode: 'client', port: addr.port, token: 'my-token' })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('returns master when health check times out', async () => {
    // Server that never responds
    const server = createServer(() => {
      // Intentionally don't respond
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address() as { port: number }

    try {
      writeLockFile(lockFilePath(tmpDir), {
        pid: process.pid,
        port: addr.port,
        token: 'tok',
        startedAt: new Date().toISOString(),
      })

      const result = await discoverMaster(tmpDir)
      expect(result).toEqual({ mode: 'master' })
    } finally {
      server.close()
    }
  })

  it('returns master when health check returns non-200', async () => {
    const server = createServer((_, res) => {
      res.writeHead(500)
      res.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const addr = server.address() as { port: number }

    try {
      writeLockFile(lockFilePath(tmpDir), {
        pid: process.pid,
        port: addr.port,
        token: 'tok',
        startedAt: new Date().toISOString(),
      })

      const result = await discoverMaster(tmpDir)
      expect(result).toEqual({ mode: 'master' })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
