import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { z } from 'zod'
import {
  createDefaultLLMProfileCatalogConfig,
  parseLLMProfileCatalogConfigFromInput,
  type LLMProfileCatalogConfig,
} from './llmProfileCatalog.js'
import {
  createDefaultMcpProfileCatalogConfig,
  parseMcpProfileCatalogConfigFromInput,
  type McpProfileCatalogConfig,
} from './mcpProfileCatalog.js'
import type { LLMProvider } from '../core/ports/llmClient.js'

export type WorkspaceProfileEnvelopeConfig = {
  llms: LLMProfileCatalogConfig
  mcp: McpProfileCatalogConfig
}

const WorkspaceProfileEnvelopeSchema = z.object({
  llms: z.unknown(),
  mcp: z.unknown().optional(),
}).strict()

function parseJsonInput(raw: string, sourceName: string): unknown {
  try {
    return JSON.parse(raw) as unknown
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`${sourceName} is not valid JSON: ${reason}`)
  }
}

function readProfileCatalogFromPath(configPath: string, sourceName: string): unknown {
  let fileContent = ''
  try {
    fileContent = readFileSync(configPath, 'utf8')
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`${sourceName} path is unreadable: ${configPath} (${reason})`)
  }
  return parseJsonInput(fileContent, `${sourceName} file (${configPath})`)
}

function readDefaultWorkspaceProfileCatalog(
  provider: LLMProvider,
  workspaceDir: string,
): { input: unknown; sourceName: string } {
  const defaultPath = resolve(workspaceDir, 'profiles.json')
  let raw = ''
  try {
    raw = readFileSync(defaultPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return {
        input: {
          llms: createDefaultLLMProfileCatalogConfig(provider),
          mcp: createDefaultMcpProfileCatalogConfig(),
        },
        sourceName: 'generated default profile catalog',
      }
    }

    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`default workspace profiles file path is unreadable: ${defaultPath} (${reason})`)
  }

  return {
    input: parseJsonInput(raw, `default workspace profiles file (${defaultPath})`),
    sourceName: `default workspace profiles file (${defaultPath})`,
  }
}

function assertStrictEnvelope(input: unknown, sourceName: string): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return

  const record = input as Record<string, unknown>

  const looksLegacy = (
    Object.prototype.hasOwnProperty.call(record, 'defaultProfile')
    || Object.prototype.hasOwnProperty.call(record, 'clientPolicies')
    || Object.prototype.hasOwnProperty.call(record, 'profiles')
  )

  if (looksLegacy && !Object.prototype.hasOwnProperty.call(record, 'llms')) {
    throw new Error(
      `${sourceName} must use strict envelope format: {"llms": {...}, "mcp": {...}}. ` +
      `Legacy top-level LLM fields are no longer supported.`,
    )
  }
}

/**
 * Parse and validate the strict workspace profile envelope.
 *
 * Input source priority:
 * 1. `SEED_LLM_PROFILES_JSON` inline JSON or path
 * 2. `<workspace>/profiles.json`
 * 3. generated defaults
 */
export function parseWorkspaceProfileEnvelopeConfig(opts: {
  raw: string | undefined
  provider: LLMProvider
  workspaceDir?: string
}): WorkspaceProfileEnvelopeConfig {
  let input: unknown
  let sourceName = 'SEED_LLM_PROFILES_JSON'

  if (!opts.raw) {
    const workspaceDir = opts.workspaceDir ?? process.cwd()
    const defaultCatalog = readDefaultWorkspaceProfileCatalog(opts.provider, workspaceDir)
    input = defaultCatalog.input
    sourceName = defaultCatalog.sourceName
  } else {
    const trimmed = opts.raw.trim()
    const looksLikeInlineJson = trimmed.startsWith('{') || trimmed.startsWith('[')
    if (looksLikeInlineJson) {
      input = parseJsonInput(trimmed, sourceName)
    } else {
      const baseDir = opts.workspaceDir ?? process.cwd()
      const configPath = isAbsolute(trimmed) ? trimmed : resolve(baseDir, trimmed)
      input = readProfileCatalogFromPath(configPath, sourceName)
    }
  }

  assertStrictEnvelope(input, sourceName)

  const envelope = WorkspaceProfileEnvelopeSchema.safeParse(input)
  if (!envelope.success) {
    const message = envelope.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ')
    throw new Error(`${sourceName} validation failed: ${message}`)
  }

  return {
    llms: parseLLMProfileCatalogConfigFromInput({
      input: envelope.data.llms,
      provider: opts.provider,
      sourceName: `${sourceName}.llms`,
    }),
    mcp: parseMcpProfileCatalogConfigFromInput({
      input: envelope.data.mcp ?? createDefaultMcpProfileCatalogConfig(),
      sourceName: `${sourceName}.mcp`,
    }),
  }
}
