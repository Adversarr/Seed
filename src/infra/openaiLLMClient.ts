import { generateText, streamText, type CoreMessage, type LanguageModel } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import type { LLMClient, LLMCompleteOptions, LLMMessage, LLMProfile, LLMStreamOptions } from '../domain/ports/llmClient.js'

function toCoreMessages(messages: LLMMessage[]): CoreMessage[] {
  return messages.map((m) => ({ role: m.role, content: m.content }))
}

export class OpenAILLMClient implements LLMClient {
  readonly #apiKey: string
  readonly #openai: ReturnType<typeof createOpenAI>
  readonly #modelByProfile: Record<LLMProfile, string>

  constructor(opts: {
    apiKey: string | null
    baseURL?: string | null
    modelByProfile: Record<LLMProfile, string>
  }) {
    if (!opts.apiKey) {
      throw new Error('缺少 OPENAI_API_KEY（或通过 config 注入 apiKey）')
    }
    this.#apiKey = opts.apiKey
    this.#openai = createOpenAI({ apiKey: this.#apiKey, baseURL: opts.baseURL ?? undefined })
    this.#modelByProfile = opts.modelByProfile
  }

  async complete(opts: LLMCompleteOptions): Promise<string> {
    const modelId = this.#modelByProfile[opts.profile]
    const { text } = await generateText({
      model: this.#openai(modelId) as unknown as LanguageModel,
      messages: toCoreMessages(opts.messages),
      maxOutputTokens: opts.maxTokens
    })
    return text
  }

  async *stream(opts: LLMStreamOptions): AsyncGenerator<string> {
    const modelId = this.#modelByProfile[opts.profile]
    const res = await streamText({
      model: this.#openai(modelId) as unknown as LanguageModel,
      messages: toCoreMessages(opts.messages),
      maxOutputTokens: opts.maxTokens
    })

    for await (const chunk of res.textStream) {
      if (chunk) yield chunk
    }
  }
}
