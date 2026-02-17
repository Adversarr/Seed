import type { LLMProfile } from '../../core/ports/llmClient.js'
import type { LLMProfileCatalogConfig } from '../../config/llmProfileCatalog.js'
import type { ToolSchemaStrategy } from '../tools/toolSchemaAdapter.js'
import { OpenAILLMClient } from './openaiLLMClient.js'
import type { NativeWebRequest, NativeWebResult } from './webNative.js'

const VOLCENGINE_DEFAULT_BASE_URL = 'https://ark.cn-beijing.volces.com/api/v3'

function normalizeBaseURL(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

function parseUnknownText(value: unknown): string {
  if (typeof value === 'string') {
    return value.trim()
  }
  if (Array.isArray(value)) {
    const combined = value
      .map((item) => parseUnknownText(item))
      .filter((part) => part.length > 0)
      .join('\n')
    return combined.trim()
  }
  if (!value || typeof value !== 'object') {
    return ''
  }

  const record = value as Record<string, unknown>
  if (typeof record.output_text === 'string') {
    return record.output_text.trim()
  }
  if (typeof record.text === 'string') {
    return record.text.trim()
  }
  if (typeof record.content === 'string') {
    return record.content.trim()
  }
  if (Array.isArray(record.content)) {
    return parseUnknownText(record.content)
  }
  if (Array.isArray(record.output)) {
    return parseUnknownText(record.output)
  }

  return ''
}

function toErrorMessage(status: number, body: string): string {
  const suffix = body.trim().length > 0 ? `: ${body.trim()}` : ''
  return `Volcengine web request failed with HTTP ${status}${suffix}`
}

export class VolcengineLLMClient extends OpenAILLMClient {
  readonly #baseURL: string
  readonly #apiKey: string
  readonly #profileCatalogConfig: LLMProfileCatalogConfig

  constructor(opts: {
    apiKey: string | null
    baseURL?: string | null
    profileCatalog: LLMProfileCatalogConfig
    toolSchemaStrategy?: ToolSchemaStrategy
    verbose?: boolean
  }) {
    super({
      provider: 'volcengine',
      apiKey: opts.apiKey,
      baseURL: opts.baseURL,
      profileCatalog: opts.profileCatalog,
      toolSchemaStrategy: opts.toolSchemaStrategy,
      verbose: opts.verbose,
    })

    if (!opts.apiKey) {
      throw new Error('Missing SEED_LLM_API_KEY (or inject apiKey via config)')
    }

    this.#apiKey = opts.apiKey
    this.#baseURL = normalizeBaseURL(opts.baseURL ?? VOLCENGINE_DEFAULT_BASE_URL)
    this.#profileCatalogConfig = opts.profileCatalog
  }

  async nativeWebSearch(request: NativeWebRequest): Promise<NativeWebResult> {
    const payload = {
      model: this.#resolveModel(request.profile),
      input: request.prompt,
      tools: [
        {
          type: 'web_search',
        },
      ],
    }

    const response = await fetch(`${this.#baseURL}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal: request.signal,
    })

    if (!response.ok) {
      const raw = await response.text().catch(() => '')
      return {
        status: 'error',
        provider: 'volcengine',
        statusCode: response.status,
        message: toErrorMessage(response.status, raw),
      }
    }

    let parsed: unknown
    try {
      parsed = await response.json()
    } catch (error) {
      return {
        status: 'error',
        provider: 'volcengine',
        message: `Failed to parse Volcengine JSON response: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    const content = parseUnknownText(parsed)
    if (content.length === 0) {
      return {
        status: 'error',
        provider: 'volcengine',
        message: 'Volcengine web response did not contain readable content',
      }
    }

    return {
      status: 'success',
      provider: 'volcengine',
      content,
    }
  }

  async nativeWebFetch(_request: NativeWebRequest): Promise<NativeWebResult> {
    return {
      status: 'unsupported',
      provider: 'volcengine',
      message: 'web_fetch is not supported for provider "volcengine" (native-only mode)',
    }
  }

  #resolveModel(profileId: LLMProfile): string {
    const profile = this.#profileCatalogConfig.profiles[profileId]
    if (!profile) {
      const valid = this.profileCatalog.profiles.map((item) => item.id).join(', ')
      throw new Error(`Unknown LLM profile: ${profileId}. Valid profiles: ${valid}`)
    }
    return profile.model
  }
}
