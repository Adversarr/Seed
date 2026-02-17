import type { LLMClient, LLMProfile, LLMProvider } from '../../core/ports/llmClient.js'

export type NativeWebSuccess = {
  status: 'success'
  provider: LLMProvider
  content: string
}

export type NativeWebUnsupported = {
  status: 'unsupported'
  provider: LLMProvider
  message: string
}

export type NativeWebError = {
  status: 'error'
  provider: LLMProvider
  message: string
  statusCode?: number
}

export type NativeWebResult = NativeWebSuccess | NativeWebUnsupported | NativeWebError

export type NativeWebRequest = {
  profile: LLMProfile
  prompt: string
  signal?: AbortSignal
}

export interface NativeWebSearchCapable {
  nativeWebSearch(request: NativeWebRequest): Promise<NativeWebResult>
}

export interface NativeWebFetchCapable {
  nativeWebFetch(request: NativeWebRequest): Promise<NativeWebResult>
}

export function hasNativeWebSearch(client: LLMClient): client is LLMClient & NativeWebSearchCapable {
  const candidate = client as Partial<NativeWebSearchCapable>
  return typeof candidate.nativeWebSearch === 'function'
}

export function hasNativeWebFetch(client: LLMClient): client is LLMClient & NativeWebFetchCapable {
  const candidate = client as Partial<NativeWebFetchCapable>
  return typeof candidate.nativeWebFetch === 'function'
}
