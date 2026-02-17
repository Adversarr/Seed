import { z } from 'zod'
import { readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type {
  LLMBuiltinProfile,
  LLMProfile,
  LLMProfileCatalog,
  LLMProvider,
  LLMRuntimeProfile,
} from '../core/ports/llmClient.js'

export const BUILTIN_LLM_PROFILE_IDS: readonly LLMBuiltinProfile[] = ['fast', 'writer', 'reasoning']

export type VolcengineThinkingType = 'enabled' | 'disabled' | 'auto'
export type VolcengineReasoningEffort = 'minimal' | 'low' | 'medium' | 'high'

export type OpenAICompatPolicy = {
  enableThinking?: boolean
}

export type ClientPolicy = {
  openaiCompat?: OpenAICompatPolicy
  provider?: {
    bailian?: {
      thinkingBudget?: number
    }
    volcengine?: {
      thinkingType?: VolcengineThinkingType
      reasoningEffort?: VolcengineReasoningEffort
    }
  }
}

export type LLMProfileSpec = {
  model: string
  clientPolicy: string
}

export type LLMProfileCatalogConfig = {
  defaultProfile: LLMProfile
  clientPolicies: Record<string, ClientPolicy>
  profiles: Record<string, LLMProfileSpec>
}

const OpenAICompatPolicySchema = z.object({
  enableThinking: z.boolean().optional(),
}).strict()

const ClientPolicySchema = z.object({
  openaiCompat: OpenAICompatPolicySchema.optional(),
  provider: z.object({
    bailian: z.object({
      thinkingBudget: z.number().int().min(1).optional(),
    }).strict().optional(),
    volcengine: z.object({
      thinkingType: z.enum(['enabled', 'disabled', 'auto']).optional(),
      reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high']).optional(),
    }).strict().optional(),
  }).strict().optional(),
}).strict()

const LLMProfileSpecSchema = z.object({
  model: z.string().min(1),
  clientPolicy: z.string().min(1),
}).strict()

const LLMProfileCatalogConfigSchema = z.object({
  defaultProfile: z.string().min(1),
  clientPolicies: z.record(z.string().min(1), ClientPolicySchema),
  profiles: z.record(z.string().min(1), LLMProfileSpecSchema),
}).strict()

function isBuiltinProfile(profile: string): profile is LLMBuiltinProfile {
  return BUILTIN_LLM_PROFILE_IDS.includes(profile as LLMBuiltinProfile)
}

function defaultModelByProvider(provider: LLMProvider): string {
  if (provider === 'bailian') return 'qwen-plus'
  if (provider === 'volcengine') return 'doubao-seed-1-6-251015'
  return 'gpt-4o-mini'
}

function createDefaultPolicy(): ClientPolicy {
  return {
    openaiCompat: {
      enableThinking: true,
    },
  }
}

export function createDefaultLLMProfileCatalogConfig(provider: LLMProvider): LLMProfileCatalogConfig {
  const defaultModel = defaultModelByProvider(provider)
  return {
    defaultProfile: 'fast',
    clientPolicies: {
      default: createDefaultPolicy(),
    },
    profiles: {
      fast: {
        model: defaultModel,
        clientPolicy: 'default',
      },
      writer: {
        model: provider === 'openai' ? 'gpt-4o' : defaultModel,
        clientPolicy: 'default',
      },
      reasoning: {
        model: provider === 'openai' ? 'gpt-4o' : defaultModel,
        clientPolicy: 'default',
      },
    },
  }
}

function validateSemanticConstraints(
  config: LLMProfileCatalogConfig,
  provider: LLMProvider,
  sourceName: string,
): void {
  for (const profileId of BUILTIN_LLM_PROFILE_IDS) {
    if (!config.profiles[profileId]) {
      throw new Error(`${sourceName} is missing required builtin profile "${profileId}"`)
    }
  }

  if (!config.profiles[config.defaultProfile]) {
    throw new Error(`${sourceName} defaultProfile "${config.defaultProfile}" does not exist in profiles`)
  }

  for (const [profileId, profile] of Object.entries(config.profiles)) {
    if (!config.clientPolicies[profile.clientPolicy]) {
      throw new Error(
        `${sourceName} profile "${profileId}" references unknown client policy "${profile.clientPolicy}"`,
      )
    }
  }

  for (const [policyName, policy] of Object.entries(config.clientPolicies)) {
    const providerConfig = policy.provider
    if (!providerConfig) continue

    const configuredProviderKeys = Object.entries(providerConfig)
      .filter(([, value]) => value !== undefined)
      .map(([key]) => key)

    if (configuredProviderKeys.length === 0) continue

    if (provider === 'openai' || provider === 'fake') {
      throw new Error(
        `${sourceName} policy "${policyName}" contains provider-specific options (${configuredProviderKeys.join(', ')}) but active provider is "${provider}"`,
      )
    }

    const unsupported = configuredProviderKeys.filter((key) => key !== provider)
    if (unsupported.length > 0) {
      throw new Error(
        `${sourceName} policy "${policyName}" contains unsupported provider-specific options (${unsupported.join(', ')}) for active provider "${provider}"`,
      )
    }
  }
}

function parseConfigInput(raw: string, sourceName: string): unknown {
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
  return parseConfigInput(fileContent, `${sourceName} file (${configPath})`)
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
        input: createDefaultLLMProfileCatalogConfig(provider),
        sourceName: 'generated default profile catalog',
      }
    }
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`default workspace profiles file path is unreadable: ${defaultPath} (${reason})`)
  }

  return {
    input: parseConfigInput(raw, `default workspace profiles file (${defaultPath})`),
    sourceName: `default workspace profiles file (${defaultPath})`,
  }
}

export function parseLLMProfileCatalogConfig(opts: {
  raw: string | undefined
  provider: LLMProvider
  workspaceDir?: string
}): LLMProfileCatalogConfig {
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
      input = parseConfigInput(trimmed, sourceName)
    } else {
      const baseDir = opts.workspaceDir ?? process.cwd()
      const configPath = isAbsolute(trimmed) ? trimmed : resolve(baseDir, trimmed)
      input = readProfileCatalogFromPath(configPath, sourceName)
    }
  }

  const result = LLMProfileCatalogConfigSchema.safeParse(input)
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ')
    throw new Error(`${sourceName} validation failed: ${message}`)
  }

  validateSemanticConstraints(result.data, opts.provider, sourceName)
  return result.data
}

function sortProfileEntries(entries: LLMRuntimeProfile[]): LLMRuntimeProfile[] {
  return entries.sort((left, right) => {
    const leftBuiltin = isBuiltinProfile(left.id)
    const rightBuiltin = isBuiltinProfile(right.id)
    if (leftBuiltin && rightBuiltin) {
      return BUILTIN_LLM_PROFILE_IDS.indexOf(left.id as LLMBuiltinProfile) - BUILTIN_LLM_PROFILE_IDS.indexOf(right.id as LLMBuiltinProfile)
    }
    if (leftBuiltin) return -1
    if (rightBuiltin) return 1
    return left.id.localeCompare(right.id)
  })
}

export function toRuntimeProfileCatalog(config: LLMProfileCatalogConfig): LLMProfileCatalog {
  const entries = Object.entries(config.profiles).map(([id, profile]): LLMRuntimeProfile => ({
    id,
    model: profile.model,
    clientPolicy: profile.clientPolicy,
    builtin: isBuiltinProfile(id),
  }))

  return {
    defaultProfile: config.defaultProfile,
    profiles: sortProfileEntries(entries),
  }
}
