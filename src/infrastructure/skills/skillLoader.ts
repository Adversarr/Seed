import { readFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { glob } from 'glob'
import type { SkillDefinition } from '../../core/entities/skill.js'
import { normalizeSkillMetadata } from '../../core/entities/skill.js'

type SkillLoadResult = {
  skills: SkillDefinition[]
  warnings: string[]
}

/**
 * Discover skills from the workspace-local skills directory only.
 *
 * Discovery scope:
 * - `<baseDir>/skills/SKILL.md`
 * - `<baseDir>/skills/<child>/SKILL.md`
 */
export async function loadSkillsFromWorkspace(baseDir: string): Promise<SkillLoadResult> {
  const skillsRoot = resolve(baseDir, 'skills')
  const warnings: string[] = []

  const discoveredFiles = await glob(['SKILL.md', '*/SKILL.md'], {
    cwd: skillsRoot,
    nodir: true,
    ignore: ['**/node_modules/**', '**/.git/**'],
  }).catch(() => [])

  const sortedFiles = [...discoveredFiles].sort((left, right) => left.localeCompare(right))
  const registry = new Map<string, SkillDefinition>()

  for (const relativeSkillFile of sortedFiles) {
    const absoluteSkillFile = resolve(skillsRoot, relativeSkillFile)

    let markdown = ''
    try {
      markdown = await readFile(absoluteSkillFile, 'utf8')
    } catch (error) {
      warnings.push(
        `[skills] failed to read ${absoluteSkillFile}: ${error instanceof Error ? error.message : String(error)}`
      )
      continue
    }

    const parsed = parseSkillMarkdown(markdown)
    if (!parsed.name || !parsed.description) {
      warnings.push(
        `[skills] skipping ${absoluteSkillFile}: missing required frontmatter fields "name" and/or "description"`
      )
      continue
    }

    const location = relative(baseDir, dirname(absoluteSkillFile)).replace(/\\/gu, '/')
    const metadata = normalizeSkillMetadata({
      name: parsed.name,
      description: parsed.description,
      location,
    })

    if (!metadata.name) {
      warnings.push(`[skills] skipping ${absoluteSkillFile}: sanitized skill name is empty`)
      continue
    }

    if (!metadata.description) {
      warnings.push(`[skills] skipping ${absoluteSkillFile}: description is empty`)
      continue
    }

    if (registry.has(metadata.name)) {
      warnings.push(
        `[skills] duplicate skill "${metadata.name}" detected; replacing previous definition with ${absoluteSkillFile}`
      )
    }

    registry.set(metadata.name, {
      ...metadata,
      skillFilePath: absoluteSkillFile,
    })
  }

  return {
    skills: [...registry.values()],
    warnings,
  }
}

type ParsedSkillMarkdown = {
  name: string | null
  description: string | null
  body: string
}

/**
 * Parse `SKILL.md` into metadata and body.
 *
 * Parsing strategy:
 * 1) strict frontmatter parser (YAML-like key/value lines)
 * 2) fallback parser extracting only `name` + `description`
 */
export function parseSkillMarkdown(markdown: string): ParsedSkillMarkdown {
  const { frontmatter, body } = splitFrontmatter(markdown)
  if (!frontmatter) {
    return { name: null, description: null, body }
  }

  try {
    const strict = parseFrontmatterStrict(frontmatter)
    return {
      name: strict.name ?? null,
      description: strict.description ?? null,
      body,
    }
  } catch {
    const fallback = parseFrontmatterFallback(frontmatter)
    return {
      name: fallback.name,
      description: fallback.description,
      body,
    }
  }
}

function splitFrontmatter(markdown: string): { frontmatter: string | null; body: string } {
  const normalized = markdown.replace(/\r\n/gu, '\n')
  const lines = normalized.split('\n')

  if (lines[0]?.trim() !== '---') {
    return { frontmatter: null, body: normalized }
  }

  let closingIndex = -1
  for (let i = 1; i < lines.length; i += 1) {
    if (lines[i]?.trim() === '---') {
      closingIndex = i
      break
    }
  }

  if (closingIndex < 0) {
    return { frontmatter: null, body: normalized }
  }

  return {
    frontmatter: lines.slice(1, closingIndex).join('\n'),
    body: lines.slice(closingIndex + 1).join('\n').trimStart(),
  }
}

/**
 * Very small strict YAML-like parser for simple scalar frontmatter.
 * Any unsupported line format throws and triggers fallback parsing.
 */
function parseFrontmatterStrict(frontmatter: string): Record<string, string> {
  const result: Record<string, string> = {}
  const lines = frontmatter.split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const match = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/u.exec(trimmed)
    if (!match) {
      throw new Error(`Invalid frontmatter line: ${line}`)
    }

    const key = match[1]!
    const rawValue = match[2]!.trim()
    result[key] = unquote(rawValue)
  }

  return result
}

function parseFrontmatterFallback(frontmatter: string): { name: string | null; description: string | null } {
  const name = matchFrontmatterField(frontmatter, 'name')
  const description = matchFrontmatterField(frontmatter, 'description')
  return { name, description }
}

function matchFrontmatterField(frontmatter: string, key: string): string | null {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const pattern = new RegExp(`^\\s*${escapedKey}\\s*:\\s*(.+)$`, 'imu')
  const match = pattern.exec(frontmatter)
  if (!match?.[1]) return null
  return unquote(match[1].trim())
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}
