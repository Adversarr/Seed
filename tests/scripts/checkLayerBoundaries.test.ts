import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { analyzeLayerBoundaries, runCli } from '../../scripts/check-layer-boundaries.js'

function writeFile(rootDir: string, relativePath: string, content: string): void {
  const fullPath = path.join(rootDir, relativePath)
  mkdirSync(path.dirname(fullPath), { recursive: true })
  writeFileSync(fullPath, content)
}

describe('check-layer-boundaries', () => {
  const tempDirs: string[] = []

  afterEach(() => {
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop()!
      rmSync(dir, { recursive: true, force: true })
    }
    vi.restoreAllMocks()
  })

  test('passes for valid import graph with interfaces importing infrastructure', () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'seed-layer-boundary-'))
    tempDirs.push(rootDir)

    writeFile(rootDir, 'src/core/ports/clock.ts', 'export const now = () => Date.now()')
    writeFile(
      rootDir,
      'src/infrastructure/time/systemClock.ts',
      "import { now } from '../../core/ports/clock.js'\nvoid now\nexport const systemClock = true"
    )
    writeFile(
      rootDir,
      'src/interfaces/app/create.ts',
      "import { systemClock } from '../../infrastructure/time/systemClock.js'\nvoid systemClock"
    )
    writeFile(
      rootDir,
      'src/agents/runtime.ts',
      "import { now } from '../core/ports/clock.js'\nvoid now"
    )

    const result = analyzeLayerBoundaries(rootDir)
    expect(result.violations).toEqual([])
  })

  test('reports forbidden agent/application/core imports from infrastructure with clear output', () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), 'seed-layer-boundary-'))
    tempDirs.push(rootDir)

    writeFile(rootDir, 'src/infrastructure/time/systemClock.ts', 'export const systemClock = true')
    writeFile(
      rootDir,
      'src/agents/runtime.ts',
      "import { systemClock } from '../infrastructure/time/systemClock.js'\nvoid systemClock"
    )

    const result = analyzeLayerBoundaries(rootDir)
    expect(result.violations).toHaveLength(1)
    expect(result.violations[0]?.moduleSpecifier).toBe('../infrastructure/time/systemClock.js')

    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const status = runCli(['--root', rootDir])

    expect(status).toBe(1)
    const output = errorSpy.mock.calls.flat().join('\n')
    expect(output).toContain('Disallowed layer imports detected:')
    expect(output).toContain('src/agents/runtime.ts')
    expect(output).toContain('../infrastructure/time/systemClock.js')
  })
})
