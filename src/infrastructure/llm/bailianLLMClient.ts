import type { LLMProfile } from '../../core/ports/llmClient.js'
import type { LLMProfileCatalogConfig } from '../../config/llmProfileCatalog.js'
import type { ToolSchemaStrategy } from '../tools/toolSchemaAdapter.js'
import { OpenAILLMClient } from './openaiLLMClient.js'
import type { NativeWebRequest, NativeWebResult } from './webNative.js'

const BAILIAN_DEFAULT_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'

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
  if (typeof record.text === 'string') {
    return record.text.trim()
  }
  if (typeof record.content === 'string') {
    return record.content.trim()
  }
  if (Array.isArray(record.content)) {
    return parseUnknownText(record.content)
  }

  return ''
}

function extractChatCompletionText(response: unknown): string {
  if (!response || typeof response !== 'object') {
    return ''
  }

  const record = response as Record<string, unknown>
  const choices = record.choices
  if (!Array.isArray(choices) || choices.length === 0) {
    return ''
  }

  const firstChoice = choices[0]
  if (!firstChoice || typeof firstChoice !== 'object') {
    return ''
  }

  const message = (firstChoice as Record<string, unknown>).message
  if (!message || typeof message !== 'object') {
    return ''
  }

  return parseUnknownText((message as Record<string, unknown>).content)
}

function toErrorMessage(status: number, body: string): string {
  const suffix = body.trim().length > 0 ? `: ${body.trim()}` : ''
  return `Bailian web request failed with HTTP ${status}${suffix}`
}

export class BailianLLMClient extends OpenAILLMClient {
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
      provider: 'bailian',
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
    this.#baseURL = normalizeBaseURL(opts.baseURL ?? BAILIAN_DEFAULT_BASE_URL)
    this.#profileCatalogConfig = opts.profileCatalog
  }

  async nativeWebSearch(request: NativeWebRequest): Promise<NativeWebResult> {
    return this.#postChatCompletion({
      model: this.#resolveModel(request.profile),
      messages: [{ role: 'user', content: request.prompt }],
      enable_search: true,
    }, request.signal)
  }

  async nativeWebFetch(request: NativeWebRequest): Promise<NativeWebResult> {
    return this.#postChatCompletion({
      model: this.#resolveModel(request.profile),
      messages: [{ role: 'user', content: request.prompt }],
      enable_search: true,
      search_options: {
        forced_search: true,
        search_strategy: 'agent_max',
      },
    }, request.signal)
  }

  #resolveModel(profileId: LLMProfile): string {
    const profile = this.#profileCatalogConfig.profiles[profileId]
    if (!profile) {
      const valid = this.profileCatalog.profiles.map((item) => item.id).join(', ')
      throw new Error(`Unknown LLM profile: ${profileId}. Valid profiles: ${valid}`)
    }
    return profile.model
  }

  async #postChatCompletion(payload: Record<string, unknown>, signal?: AbortSignal): Promise<NativeWebResult> {
    const response = await fetch(`${this.#baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.#apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      signal,
    })

    if (!response.ok) {
      const raw = await response.text().catch(() => '')
      return {
        status: 'error',
        provider: 'bailian',
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
        provider: 'bailian',
        message: `Failed to parse Bailian JSON response: ${error instanceof Error ? error.message : String(error)}`,
      }
    }

    const content = extractChatCompletionText(parsed)
    if (content.length === 0) {
      return {
        status: 'error',
        provider: 'bailian',
        message: 'Bailian web response did not contain readable content',
      }
    }

    return {
      status: 'success',
      provider: 'bailian',
      content,
    }
  }
}
