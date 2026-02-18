import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ToolContext } from '../../src/core/ports/tool.js'
import { DefaultSkillRegistry } from '../../src/infrastructure/skills/skillRegistry.js'
import { SkillManager } from '../../src/infrastructure/skills/skillManager.js'
import { createActivateSkillTool } from '../../src/infrastructure/tools/activateSkill.js'

function createWorkspaceWithSkills(): string {
  const dir = mkdtempSync(join(tmpdir(), 'seed-activate-skill-'))
  mkdirSync(join(dir, 'skills', 'repo-survey', 'references'), { recursive: true })
  mkdirSync(join(dir, 'skills', 'safe-edit', 'scripts'), { recursive: true })

  writeFileSync(
    join(dir, 'skills', 'repo-survey', 'SKILL.md'),
    [
      '---',
      'name: repo-survey',
      'description: Survey the repository before coding.',
      '---',
      '',
      '# Repo Survey',
      '',
      'Step 1: scan file layout.',
      'Step 2: identify hotspots.',
    ].join('\n'),
    'utf8'
  )
  writeFileSync(join(dir, 'skills', 'repo-survey', 'references', 'checklist.md'), '- gather evidence\n', 'utf8')

  writeFileSync(
    join(dir, 'skills', 'safe-edit', 'SKILL.md'),
    [
      '---',
      'name: safe-edit',
      'description: Apply minimal edits with checks.',
      '---',
      '',
      '# Safe Edit',
      '',
      'Use narrow patches and run tests.',
    ].join('\n'),
    'utf8'
  )
  writeFileSync(join(dir, 'skills', 'safe-edit', 'scripts', 'guard.sh'), '#!/usr/bin/env bash\necho ok\n', 'utf8')

  return dir
}

function createToolContext(baseDir: string, taskId: string): ToolContext {
  return {
    taskId,
    actorId: 'agent_seed_coordinator',
    baseDir,
    artifactStore: {} as any,
  }
}

describe('activateSkill tool', () => {
  it('is risky before first activation and safe afterwards in the same task', async () => {
    const dir = createWorkspaceWithSkills()
    const registry = new DefaultSkillRegistry()
    const manager = new SkillManager({ baseDir: dir, registry })
    await manager.discoverWorkspaceSkills()
    manager.setTaskVisibleSkills('task-1', ['repo-survey'])
    const tool = createActivateSkillTool({ skillManager: manager })
    const ctx = createToolContext(dir, 'task-1')

    try {
      expect(tool.riskLevel({ name: 'repo-survey' }, ctx)).toBe('risky')

      const first = await tool.execute({ name: 'repo-survey' }, ctx)
      expect(first.isError).toBe(false)
      expect(first.output).toMatchObject({
        success: true,
        alreadyActivated: false,
        mountPath: 'private:/.skills/repo-survey',
      })
      expect(String((first.output as any).instructions)).toContain('Step 1: scan file layout.')
      expect(String((first.output as any).folderStructure)).toContain('references/')
      expect(existsSync(join(dir, 'private', 'task-1', '.skills', 'repo-survey', 'references', 'checklist.md'))).toBe(true)

      expect(tool.riskLevel({ name: 'repo-survey' }, ctx)).toBe('safe')

      const second = await tool.execute({ name: 'repo-survey' }, ctx)
      expect(second.isError).toBe(false)
      expect(second.output).toMatchObject({ success: true, alreadyActivated: true })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('returns error with visible list for unknown or invisible skills', async () => {
    const dir = createWorkspaceWithSkills()
    const registry = new DefaultSkillRegistry()
    const manager = new SkillManager({ baseDir: dir, registry })
    await manager.discoverWorkspaceSkills()
    manager.setTaskVisibleSkills('task-2', ['repo-survey'])
    const tool = createActivateSkillTool({ skillManager: manager })
    const ctx = createToolContext(dir, 'task-2')

    try {
      const invisible = await tool.execute({ name: 'safe-edit' }, ctx)
      expect(invisible.isError).toBe(true)
      expect(invisible.output).toMatchObject({
        error: 'Unknown or unavailable skill: safe-edit',
        availableSkills: ['repo-survey'],
      })

      const unknown = await tool.execute({ name: 'does-not-exist' }, ctx)
      expect(unknown.isError).toBe(true)
      expect(unknown.output).toMatchObject({
        error: 'Unknown or unavailable skill: does-not-exist',
        availableSkills: ['repo-survey'],
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('mounts resources under task-private path for tool access', async () => {
    const dir = createWorkspaceWithSkills()
    const registry = new DefaultSkillRegistry()
    const manager = new SkillManager({ baseDir: dir, registry })
    await manager.discoverWorkspaceSkills()
    manager.setTaskVisibleSkills('task-3', ['safe-edit'])
    const tool = createActivateSkillTool({ skillManager: manager })
    const ctx = createToolContext(dir, 'task-3')

    try {
      const result = await tool.execute({ name: 'safe-edit' }, ctx)
      expect(result.isError).toBe(false)
      expect(result.output).toMatchObject({
        success: true,
        mountPath: 'private:/.skills/safe-edit',
      })

      const mountedScript = join(dir, 'private', 'task-3', '.skills', 'safe-edit', 'scripts', 'guard.sh')
      expect(existsSync(mountedScript)).toBe(true)
      expect(readFileSync(mountedScript, 'utf8')).toContain('echo ok')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
