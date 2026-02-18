import type { SkillDefinition } from '../../core/entities/skill.js'
import { sanitizeSkillName } from '../../core/entities/skill.js'
import type { SkillRegistry } from '../../core/ports/skill.js'

/**
 * Infrastructure Layer - Skill Registry Implementation
 *
 * Mutable registry for discovered skills.
 */
export class DefaultSkillRegistry implements SkillRegistry {
  readonly #skills = new Map<string, SkillDefinition>()

  registerOrReplace(skill: SkillDefinition): { replaced: boolean } {
    const normalizedName = sanitizeSkillName(skill.name)
    const replaced = this.#skills.has(normalizedName)
    this.#skills.set(normalizedName, { ...skill, name: normalizedName })
    return { replaced }
  }

  get(name: string): SkillDefinition | undefined {
    return this.#skills.get(sanitizeSkillName(name))
  }

  list(): SkillDefinition[] {
    return [...this.#skills.values()]
  }

  listByNames(names: readonly string[]): SkillDefinition[] {
    const nameSet = new Set(names.map((name) => sanitizeSkillName(name)))
    return this.list().filter((skill) => nameSet.has(skill.name))
  }
}

export function createSkillRegistry(): SkillRegistry {
  return new DefaultSkillRegistry()
}
