import type { LLMClient, LLMProfile } from '../../core/ports/llmClient.js'
import {
  hasNativeWebFetch,
  hasNativeWebSearch,
  type NativeWebResult,
} from '../llm/webNative.js'

export type WebSubagentRequest = {
  llm: LLMClient
  profile: LLMProfile
  prompt: string
  signal?: AbortSignal
}

function unsupportedResult(llm: LLMClient, capability: 'web_search' | 'web_fetch'): NativeWebResult {
  return {
    status: 'unsupported',
    provider: llm.provider,
    message: `${capability} is not supported for provider "${llm.provider}"`,
  }
}

export function hasProfile(llm: LLMClient, profile: LLMProfile): boolean {
  return llm.profileCatalog.profiles.some((item) => item.id === profile)
}

export async function executeWebSearchSubagent(request: WebSubagentRequest): Promise<NativeWebResult> {
  if (!hasNativeWebSearch(request.llm)) {
    return unsupportedResult(request.llm, 'web_search')
  }

  return request.llm.nativeWebSearch({
    profile: request.profile,
    prompt: request.prompt,
    signal: request.signal,
  })
}

export async function executeWebFetchSubagent(request: WebSubagentRequest): Promise<NativeWebResult> {
  if (!hasNativeWebFetch(request.llm)) {
    return unsupportedResult(request.llm, 'web_fetch')
  }

  return request.llm.nativeWebFetch({
    profile: request.profile,
    prompt: request.prompt,
    signal: request.signal,
  })
}
