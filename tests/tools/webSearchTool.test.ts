import { afterEach, describe, expect, test, vi } from 'vitest'

vi.mock('@ai-sdk/openai-compatible', () => ({
  createOpenAICompatible: () => {
    return (modelId: string) => ({ modelId })
  },
}))

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
  jsonSchema: vi.fn((schema: unknown) => ({ schema })),
}))

vi.mock('ai', () => ({
  generateText: mocks.generateText,
  streamText: mocks.streamText,
  jsonSchema: mocks.jsonSchema,
}))

import type { ArtifactStore } from '../../src/core/ports/artifactStore.js'
import type { ToolContext } from '../../src/core/ports/tool.js'
import { OpenAILLMClient } from '../../src/infrastructure/llm/openaiLLMClient.js'
import { BailianLLMClient } from '../../src/infrastructure/llm/bailianLLMClient.js'
import { createWebSearchTool } from '../../src/infrastructure/tools/webSearch.js'

function createProfileCatalog(model = 'model-web') {
  return {
    defaultProfile: 'fast',
    clientPolicies: {
      default: {
        openaiCompat: {
          enableThinking: true,
        },
      },
    },
    profiles: {
      fast: { model: 'model-fast', clientPolicy: 'default' },
      writer: { model: 'model-writer', clientPolicy: 'default' },
      reasoning: { model: 'model-reasoning', clientPolicy: 'default' },
      research_web: { model, clientPolicy: 'default' },
    },
  }
}

const artifactStore: ArtifactStore = {
  readFile: async () => '',
  readFileRange: async () => '',
  listDir: async () => [],
  writeFile: async () => {},
  exists: async () => false,
  mkdir: async () => {},
  glob: async () => [],
  stat: async () => null,
}

const ctx: ToolContext = {
  taskId: 'task-1',
  actorId: 'actor-1',
  baseDir: process.cwd(),
  artifactStore,
}

describe('web_search tool', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('validates non-empty query input', async () => {
    const llm = new OpenAILLMClient({
      provider: 'openai',
      apiKey: 'openai-key',
      profileCatalog: createProfileCatalog(),
    })

    const tool = createWebSearchTool({
      llm,
      profile: 'research_web',
    })

    const result = await tool.execute({ query: '   ' }, ctx)

    expect(result.isError).toBe(true)
    expect(result.output).toEqual({ error: 'query must be a non-empty string' })
  })

  test('returns successful content for Bailian native search', async () => {
    globalThis.fetch = (async () => {
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'fresh web result' } }],
      }), { status: 200 })
    }) as typeof fetch

    const llm = new BailianLLMClient({
      apiKey: 'bailian-key',
      profileCatalog: createProfileCatalog('qwen-web'),
    })

    const tool = createWebSearchTool({
      llm,
      profile: 'research_web',
    })

    const result = await tool.execute({ query: 'latest chips' }, ctx)

    expect(result.isError).toBe(false)
    expect(result.output).toMatchObject({
      provider: 'bailian',
      profile: 'research_web',
      query: 'latest chips',
      content: 'fresh web result',
    })
  })

  test('returns deterministic unsupported result for OpenAI provider', async () => {
    const llm = new OpenAILLMClient({
      provider: 'openai',
      apiKey: 'openai-key',
      profileCatalog: createProfileCatalog(),
    })

    const tool = createWebSearchTool({
      llm,
      profile: 'research_web',
    })

    const result = await tool.execute({ query: 'query' }, ctx)

    expect(result.isError).toBe(true)
    expect(result.output).toMatchObject({
      provider: 'openai',
      status: 'unsupported',
    })
  })
})
