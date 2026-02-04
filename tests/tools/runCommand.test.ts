import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { runCommandTool } from '../../src/infra/tools/runCommand.js'
import { tmpdir } from 'node:os'
import { nanoid } from 'nanoid'

describe('runCommandTool', () => {
  let baseDir: string

  beforeEach(() => {
    baseDir = join(tmpdir(), `coauthor-run-${nanoid()}`)
    mkdirSync(baseDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true })
  })

  it('should execute echo command', async () => {
    const result = await runCommandTool.execute({
      command: 'echo "hello world"'
    }, { baseDir, taskId: 't1', actorId: 'a1' })

    expect(result.isError).toBe(false)
    expect((result.output as any).stdout).toContain('hello world')
    expect((result.output as any).exitCode).toBe(0)
  })

  it('should handle command failure', async () => {
    const result = await runCommandTool.execute({
      command: 'exit 1'
    }, { baseDir, taskId: 't1', actorId: 'a1' })

    // execSync throws on non-zero exit code
    // The tool catches it and returns isError: true
    expect(result.isError).toBe(true)
    expect((result.output as any).exitCode).toBe(1)
  })

  it('should respect timeout', async () => {
    const result = await runCommandTool.execute({
      command: 'sleep 2',
      timeout: 100 // 100ms
    }, { baseDir, taskId: 't1', actorId: 'a1' })

    expect(result.isError).toBe(true)
    // Error message might vary by OS but should indicate timeout or signal
  })
})
