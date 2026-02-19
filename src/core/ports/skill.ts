import type { SkillActivationResult, SkillDefinition } from '../entities/skill.js'

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

/**
 * Task-scoped skill session contract.
 *
 * Owns visibility and activation state for one runtime task session.
 * Implementations may persist this in-memory (default) or externally.
 */
export interface SkillSessionManager {
  setTaskVisibleSkills(taskId: string, visibleSkillNames: readonly string[]): void
  clearTaskSession(taskId: string): void
  listVisibleSkills(taskId: string): SkillDefinition[]
  getVisibleSkill(taskId: string, name: string): SkillDefinition | undefined
  isActivationConsentRequired(taskId: string, skillName: string): boolean
  isActivated(taskId: string, skillName: string): boolean
  activateSkill(taskId: string, skillName: string): Promise<SkillActivationResult>
}
