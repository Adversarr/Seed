import { describe, expect, test } from 'vitest'
import type { SkillDefinition } from '../../src/core/entities/skill.js'
import { FilteredSkillRegistry } from '../../src/core/policies/filteredSkillRegistry.js'
import { DefaultSkillRegistry } from '../../src/infrastructure/skills/skillRegistry.js'

function createSkill(name: string): SkillDefinition {
  return {
    name,
    description: `${name} description`,
    location: `skills/${name}`,
    skillFilePath: `/tmp/${name}/SKILL.md`,
  }
}

describe('DefaultSkillRegistry', () => {
  test('registers and resolves skills by sanitized name', () => {
    const registry = new DefaultSkillRegistry()
    registry.registerOrReplace(createSkill('Repo Survey'))

    const stored = registry.get('repo-survey')
    expect(stored?.name).toBe('repo-survey')
    expect(registry.list()).toHaveLength(1)
  })

  test('registerOrReplace reports replacement state', () => {
    const registry = new DefaultSkillRegistry()
    const first = registry.registerOrReplace(createSkill('same'))
    const second = registry.registerOrReplace({
      ...createSkill('same'),
      description: 'updated',
    })

    expect(first.replaced).toBe(false)
    expect(second.replaced).toBe(true)
    expect(registry.get('same')?.description).toBe('updated')
  })

  test('lists by name subset', () => {
    const registry = new DefaultSkillRegistry()
    registry.registerOrReplace(createSkill('alpha'))
    registry.registerOrReplace(createSkill('beta'))

    const subset = registry.listByNames(['beta'])
    expect(subset.map((skill) => skill.name)).toEqual(['beta'])
  })
})

describe('FilteredSkillRegistry', () => {
  test('exposes only allowlisted names', () => {
    const base = new DefaultSkillRegistry()
    base.registerOrReplace(createSkill('alpha'))
    base.registerOrReplace(createSkill('beta'))

    const filtered = new FilteredSkillRegistry(base, ['alpha'])
    expect(filtered.get('alpha')?.name).toBe('alpha')
    expect(filtered.get('beta')).toBeUndefined()
    expect(filtered.list().map((skill) => skill.name)).toEqual(['alpha'])
  })

  test('supports wildcard allowlist', () => {
    const base = new DefaultSkillRegistry()
    base.registerOrReplace(createSkill('alpha'))
    base.registerOrReplace(createSkill('beta'))

    const filtered = new FilteredSkillRegistry(base, ['*'])
    expect(filtered.list().map((skill) => skill.name).sort()).toEqual(['alpha', 'beta'])
  })

  test('is read-only', () => {
    const base = new DefaultSkillRegistry()
    const filtered = new FilteredSkillRegistry(base, ['*'])
    expect(() => filtered.registerOrReplace(createSkill('new'))).toThrow('FilteredSkillRegistry is read-only')
  })
})
