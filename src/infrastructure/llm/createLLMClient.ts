import type { AppConfig } from '../../config/appConfig.js'
import type { LLMClient } from '../../core/ports/llmClient.js'
import { toRuntimeProfileCatalog } from '../../config/llmProfileCatalog.js'
import { FakeLLMClient } from './fakeLLMClient.js'
import { OpenAILLMClient } from './openaiLLMClient.js'
import { BailianLLMClient } from './bailianLLMClient.js'
import { VolcengineLLMClient } from './volcengineLLMClient.js'

/**
 * Build the runtime LLM client from validated app config.
 *
 * Shared by app composition and CLI diagnostics so provider/profile
 * resolution logic stays in one place.
 */
export function createLLMClient(config: AppConfig): LLMClient {
  if (config.llm.provider === 'fake') {
    return new FakeLLMClient({
      profileCatalog: toRuntimeProfileCatalog(config.llm.profiles),
    })
  }

  if (config.llm.provider === 'openai') {
    return new OpenAILLMClient({
      provider: 'openai',
      apiKey: config.llm.apiKey,
      baseURL: config.llm.baseURL,
      profileCatalog: config.llm.profiles,
      toolSchemaStrategy: config.toolSchema.strategy,
    })
  }

  if (config.llm.provider === 'bailian') {
    return new BailianLLMClient({
      apiKey: config.llm.apiKey,
      baseURL: config.llm.baseURL,
      profileCatalog: config.llm.profiles,
      toolSchemaStrategy: config.toolSchema.strategy,
    })
  }

  return new VolcengineLLMClient({
    apiKey: config.llm.apiKey,
    baseURL: config.llm.baseURL,
    profileCatalog: config.llm.profiles,
    toolSchemaStrategy: config.toolSchema.strategy,
  })
}
