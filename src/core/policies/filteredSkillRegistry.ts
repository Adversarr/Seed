import type { SkillDefinition } from '../entities/skill.js'
import { sanitizeSkillName } from '../entities/skill.js'
import type { SkillRegistry } from '../ports/skill.js'

/**
 * Core Policy - Filtered Skill Registry
 *
 * Read-only adapter used to restrict visible skills per agent.
 */
export class FilteredSkillRegistry implements SkillRegistry {
  readonly #inner: SkillRegistry
  readonly #allowAll: boolean
  readonly #allowedNames: ReadonlySet<string>

  constructor(inner: SkillRegistry, allowlist: readonly string[]) {
    this.#inner = inner
    this.#allowAll = allowlist.includes('*')
    this.#allowedNames = new Set(allowlist.map((name) => sanitizeSkillName(name)))
  }

  registerOrReplace(_skill: SkillDefinition): { replaced: boolean } {
    throw new Error('FilteredSkillRegistry is read-only')
  }

  get(name: string): SkillDefinition | undefined {
    const normalized = sanitizeSkillName(name)
    if (!this.#allowAll && !this.#allowedNames.has(normalized)) {
      return undefined
    }
    return this.#inner.get(normalized)
  }

  list(): SkillDefinition[] {
    if (this.#allowAll) {
      return this.#inner.list()
    }
    return this.#inner.list().filter((skill) => this.#allowedNames.has(skill.name))
  }

  listByNames(names: readonly string[]): SkillDefinition[] {
    const requested = new Set(names.map((name) => sanitizeSkillName(name)))
    return this.list().filter((skill) => requested.has(skill.name))
  }
}
