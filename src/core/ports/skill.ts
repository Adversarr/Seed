import type { SkillDefinition } from '../entities/skill.js'

/**
 * Domain Layer - Skill Registry Port
 *
 * Registry abstraction for discovered skill metadata.
 * Concrete implementations may be mutable (default registry) or read-only
 * filtered adapters (per-agent visibility views).
 */
export interface SkillRegistry {
  /**
   * Register a skill or replace an existing skill with the same name.
   *
   * Returns whether an existing definition was replaced.
   */
  registerOrReplace(skill: SkillDefinition): { replaced: boolean }

  /** Lookup by skill name (sanitized ID). */
  get(name: string): SkillDefinition | undefined

  /** List all visible skills in this registry view. */
  list(): SkillDefinition[]

  /**
   * List skills whose names are in the provided set.
   * Used by filtered visibility adapters and tests.
   */
  listByNames(names: readonly string[]): SkillDefinition[]
}
