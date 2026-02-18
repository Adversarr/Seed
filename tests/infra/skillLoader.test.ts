import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { loadSkillsFromWorkspace, parseSkillMarkdown } from '../../src/infrastructure/skills/skillLoader.js'

function createWorkspace(): string {
  return mkdtempSync(join(tmpdir(), 'seed-skill-loader-'))
}

describe('skillLoader', () => {
  test('discovers root and nested skills from workspace skills directory', async () => {
    const dir = createWorkspace()

    try {
      mkdirSync(join(dir, 'skills'), { recursive: true })
      mkdirSync(join(dir, 'skills', 'nested-skill'), { recursive: true })

      writeFileSync(
        join(dir, 'skills', 'SKILL.md'),
        [
          '---',
          'name: root skill',
          'description: root description',
          '---',
          '',
          '# Root',
        ].join('\n'),
        'utf8'
      )

      writeFileSync(
        join(dir, 'skills', 'nested-skill', 'SKILL.md'),
        [
          '---',
          'name: nested skill',
          'description: nested description',
          '---',
          '',
          '# Nested',
        ].join('\n'),
        'utf8'
      )

      const loaded = await loadSkillsFromWorkspace(dir)
      const names = loaded.skills.map((skill) => skill.name).sort()

      expect(names).toEqual(['nested-skill', 'root-skill'])
      expect(loaded.warnings).toEqual([])
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('skips malformed skills and reports warnings', async () => {
    const dir = createWorkspace()

    try {
      mkdirSync(join(dir, 'skills', 'broken'), { recursive: true })
      writeFileSync(
        join(dir, 'skills', 'broken', 'SKILL.md'),
        [
          '---',
          'name: broken skill',
          '---',
          '',
          '# Broken',
        ].join('\n'),
        'utf8'
      )

      const loaded = await loadSkillsFromWorkspace(dir)

      expect(loaded.skills).toHaveLength(0)
      expect(loaded.warnings.some((warning) => warning.includes('missing required frontmatter fields'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('falls back to permissive metadata extraction when strict parse fails', async () => {
    const markdown = [
      '---',
      'name: fallback skill',
      'description: supports: colon values',
      'extra:',
      '  - this strict parser does not support arrays',
      '---',
      '',
      'Follow the instructions.',
    ].join('\n')

    const parsed = parseSkillMarkdown(markdown)

    expect(parsed.name).toBe('fallback skill')
    expect(parsed.description).toBe('supports: colon values')
    expect(parsed.body).toContain('Follow the instructions.')
  })

  test('keeps the last discovered skill when names collide', async () => {
    const dir = createWorkspace()

    try {
      mkdirSync(join(dir, 'skills', 'a'), { recursive: true })
      mkdirSync(join(dir, 'skills', 'z'), { recursive: true })

      writeFileSync(
        join(dir, 'skills', 'a', 'SKILL.md'),
        [
          '---',
          'name: duplicate skill',
          'description: first description',
          '---',
          '',
          'first body',
        ].join('\n'),
        'utf8'
      )

      writeFileSync(
        join(dir, 'skills', 'z', 'SKILL.md'),
        [
          '---',
          'name: duplicate skill',
          'description: second description',
          '---',
          '',
          'second body',
        ].join('\n'),
        'utf8'
      )

      const loaded = await loadSkillsFromWorkspace(dir)
      expect(loaded.skills).toHaveLength(1)
      expect(loaded.skills[0]?.description).toBe('second description')
      expect(loaded.warnings.some((warning) => warning.includes('duplicate skill'))).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
