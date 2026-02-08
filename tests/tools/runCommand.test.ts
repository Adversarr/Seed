import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { runCommandTool } from '../../src/infra/tools/runCommand.js'
import { EventEmitter } from 'node:events'

// Helper: create a minimal mock ChildProcess (EventEmitter with .kill())
function mockChildProcess() {
  const cp = new EventEmitter() as any
  cp.kill = vi.fn(() => { cp.emit('exit', null, 'SIGTERM') })
  return cp
}

// Mock child_process
const mockExec = vi.fn()
vi.mock('node:child_process', () => ({
  exec: (...args: any[]) => mockExec(...args)
}))

describe('runCommandTool', () => {
  const baseDir = '/test-workspace'

  beforeEach(() => {
    vi.clearAllMocks()
    // Default mock behavior: success
    mockExec.mockImplementation((cmd: string, options: any, cb: any) => {
      const cp = mockChildProcess()
      cb(null, 'default output', '')
      queueMicrotask(() => cp.emit('exit', 0, null))
      return cp
    })
  })
  
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('should execute echo command', async () => {
    mockExec.mockImplementation((cmd: string, options: any, cb: any) => {
      const cp = mockChildProcess()
      // simulate echo — exec callback: (error, stdout: string, stderr: string)
      if (cmd.startsWith('echo')) {
        const output = cmd.replace('echo ', '').replace(/"/g, '')
        cb(null, output, '')
      } else {
        cb(null, '', '')
      }
      queueMicrotask(() => cp.emit('exit', 0, null))
      return cp
    })

    const result = await runCommandTool.execute({
      command: 'echo "hello world"'
    }, { baseDir, taskId: 't1', actorId: 'a1' })

    expect(result.isError).toBe(false)
    expect((result.output as any).stdout).toContain('hello world')
    expect((result.output as any).exitCode).toBe(0)
    expect(mockExec).toHaveBeenCalledWith('echo "hello world"', expect.objectContaining({ cwd: baseDir }), expect.any(Function))
  })

  it('should handle command failure', async () => {
    mockExec.mockImplementation((cmd: string, options: any, cb: any) => {
      const cp = mockChildProcess()
      // simulate failure — error has stdout/stderr as string props
      const error: any = new Error('Command failed')
      error.code = 1
      error.stdout = ''
      error.stderr = 'some error'
      cb(error, '', 'some error')
      queueMicrotask(() => cp.emit('exit', 1, null))
      return cp
    })

    const result = await runCommandTool.execute({
      command: 'exit 1'
    }, { baseDir, taskId: 't1', actorId: 'a1' })

    expect(result.isError).toBe(true)
    expect((result.output as any).exitCode).toBe(1)
    expect((result.output as any).stderr).toBe('some error')
  })

  it('should respect timeout', async () => {
    mockExec.mockImplementation((cmd: string, options: any, cb: any) => {
      const cp = mockChildProcess()
      cb(null, '', '')
      queueMicrotask(() => cp.emit('exit', 0, null))
      return cp
    })

    const result = await runCommandTool.execute({
      command: 'sleep 2',
      timeout: 100
    }, { baseDir, taskId: 't1', actorId: 'a1' })

    expect(mockExec).toHaveBeenCalledWith('sleep 2', expect.objectContaining({ timeout: 100 }), expect.any(Function))
  })

  it('should return error when signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()

    const result = await runCommandTool.execute({
      command: 'echo test'
    }, { baseDir, taskId: 't1', actorId: 'a1', signal: controller.signal })

    expect(result.isError).toBe(true)
    expect((result.output as any).error).toContain('aborted')
    expect(mockExec).not.toHaveBeenCalled()
  })
})
