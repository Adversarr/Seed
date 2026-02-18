import { basename, dirname, resolve } from 'node:path'
import { cp, mkdir, readdir, readFile, rm } from 'node:fs/promises'
import type { SkillActivationResult, SkillDefinition } from '../../core/entities/skill.js'
import { sanitizeSkillName } from '../../core/entities/skill.js'
import type { SkillRegistry } from '../../core/ports/skill.js'
import { loadSkillsFromWorkspace, parseSkillMarkdown } from './skillLoader.js'

type TaskSkillSession = {
  consented: Set<string>
  activated: Set<string>
  visible: Set<string> | null
}

export class SkillManager {
  readonly #baseDir: string
  readonly #registry: SkillRegistry
  readonly #sessions = new Map<string, TaskSkillSession>()

  constructor(opts: {
    baseDir: string
    registry: SkillRegistry
  }) {
    this.#baseDir = resolve(opts.baseDir)
    this.#registry = opts.registry
  }

  async discoverWorkspaceSkills(): Promise<{ loaded: number; warnings: string[] }> {
    const loaded = await loadSkillsFromWorkspace(this.#baseDir)
    for (const skill of loaded.skills) {
      this.#registry.registerOrReplace(skill)
    }
    return {
      loaded: loaded.skills.length,
      warnings: loaded.warnings,
    }
  }

  listSkills(): SkillDefinition[] {
    return this.#registry.list()
  }

  setTaskVisibleSkills(taskId: string, visibleSkillNames: readonly string[]): void {
    const session = this.#getOrCreateSession(taskId)
    session.visible = new Set(visibleSkillNames.map((name) => sanitizeSkillName(name)))
  }

  clearTaskSession(taskId: string): void {
    this.#sessions.delete(taskId)
  }

  listVisibleSkills(taskId: string): SkillDefinition[] {
    const session = this.#sessions.get(taskId)
    if (!session?.visible) {
      return this.#registry.list()
    }
    if (session.visible.size === 0) {
      return []
    }
    return this.#registry.list().filter((skill) => session.visible?.has(skill.name))
  }

  getVisibleSkill(taskId: string, name: string): SkillDefinition | undefined {
    const normalizedName = sanitizeSkillName(name)
    return this.listVisibleSkills(taskId).find((skill) => skill.name === normalizedName)
  }

  isActivationConsentRequired(taskId: string, skillName: string): boolean {
    const normalizedName = sanitizeSkillName(skillName)
    const session = this.#sessions.get(taskId)
    if (!session) return true
    return !session.consented.has(normalizedName)
  }

  isActivated(taskId: string, skillName: string): boolean {
    const normalizedName = sanitizeSkillName(skillName)
    return this.#sessions.get(taskId)?.activated.has(normalizedName) ?? false
  }

  async activateSkill(taskId: string, skillName: string): Promise<SkillActivationResult> {
    const normalizedName = sanitizeSkillName(skillName)
    const skill = this.#registry.get(normalizedName)
    if (!skill) {
      throw new Error(`Skill not found: ${skillName}`)
    }

    const session = this.#getOrCreateSession(taskId)
    const alreadyActivated = session.activated.has(skill.name)

    const skillFileContent = await readFile(skill.skillFilePath, 'utf8')
    const parsed = parseSkillMarkdown(skillFileContent)
    if (!parsed.body.trim()) {
      throw new Error(`Skill body is empty: ${skill.name}`)
    }

    await this.#materializeSkillResources(taskId, skill)
    const folderStructure = await this.#renderFolderStructure(dirname(skill.skillFilePath))

    session.consented.add(skill.name)
    session.activated.add(skill.name)

    return {
      name: skill.name,
      description: skill.description,
      location: skill.location,
      mountPath: this.getMountPath(skill.name),
      folderStructure,
      body: parsed.body,
      alreadyActivated,
    }
  }

  getMountPath(skillName: string): string {
    return `private:/.skills/${sanitizeSkillName(skillName)}`
  }

  async #materializeSkillResources(taskId: string, skill: SkillDefinition): Promise<void> {
    const sourceDir = dirname(skill.skillFilePath)
    const targetDir = resolve(this.#baseDir, 'private', taskId, '.skills', skill.name)

    await rm(targetDir, { recursive: true, force: true })
    await mkdir(dirname(targetDir), { recursive: true })
    await cp(sourceDir, targetDir, {
      recursive: true,
      filter: (src) => {
        const name = basename(src)
        return name !== '.git' && name !== 'node_modules'
      },
    })
  }

  async #renderFolderStructure(rootDir: string): Promise<string> {
    const lines: string[] = [`${basename(rootDir)}/`]
    await this.#walkFolderTree(rootDir, 1, lines)
    return lines.join('\n')
  }

  async #walkFolderTree(dir: string, depth: number, lines: string[]): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      const indent = '  '.repeat(depth)
      if (entry.isDirectory()) {
        lines.push(`${indent}${entry.name}/`)
        await this.#walkFolderTree(resolve(dir, entry.name), depth + 1, lines)
      } else {
        lines.push(`${indent}${entry.name}`)
      }
    }
  }

  #getOrCreateSession(taskId: string): TaskSkillSession {
    const existing = this.#sessions.get(taskId)
    if (existing) return existing

    const created: TaskSkillSession = {
      consented: new Set<string>(),
      activated: new Set<string>(),
      visible: null,
    }
    this.#sessions.set(taskId, created)
    return created
  }
}
