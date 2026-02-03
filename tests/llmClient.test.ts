import { beforeEach, describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  return {
    generateText: vi.fn(),
    streamText: vi.fn(),
    createOpenAI: vi.fn()
  }
})

vi.mock('ai', () => {
  return {
    generateText: mocks.generateText,
    streamText: mocks.streamText
  }
})

vi.mock('@ai-sdk/openai', () => {
  return {
    createOpenAI: mocks.createOpenAI
  }
})

import { OpenAILLMClient } from '../src/infra/openaiLLMClient.js'

describe('OpenAILLMClient (LLMClient port)', () => {
  beforeEach(() => {
    mocks.generateText.mockReset()
    mocks.streamText.mockReset()
    mocks.createOpenAI.mockReset()
  })

  test('throws a readable error when api key is missing', () => {
    expect(
      () =>
        new OpenAILLMClient({
          apiKey: null,
          modelByProfile: { fast: 'm1', writer: 'm2', reasoning: 'm3' }
        })
    ).toThrow(/OPENAI_API_KEY/)
  })

  test('complete routes by profile and returns LLMResponse', async () => {
    mocks.createOpenAI.mockReturnValue((modelId: string) => ({ modelId }))
    mocks.generateText.mockResolvedValue({ 
      text: 'hello', 
      toolCalls: [],
      finishReason: 'stop'
    })

    const llm = new OpenAILLMClient({
      apiKey: 'k',
      modelByProfile: { fast: 'fast-model', writer: 'writer-model', reasoning: 'reasoning-model' }
    })

    const response = await llm.complete({
      profile: 'writer',
      messages: [
        { role: 'system', content: 'S' },
        { role: 'user', content: 'U' }
      ],
      maxTokens: 123
    })

    expect(response.content).toBe('hello')
    expect(response.stopReason).toBe('end_turn')
    expect(mocks.generateText).toHaveBeenCalledTimes(1)
    const args = mocks.generateText.mock.calls[0]![0] as any
    expect(args.model.modelId).toBe('writer-model')
    expect(args.maxOutputTokens).toBe(123)
  })

  test('stream yields chunks from fullStream', async () => {
    mocks.createOpenAI.mockReturnValue((modelId: string) => ({ modelId }))
    mocks.streamText.mockResolvedValue({
      fullStream: (async function* () {
        yield { type: 'text-delta', textDelta: 'a' }
        yield { type: 'text-delta', textDelta: 'b' }
        yield { type: 'finish', finishReason: 'stop' }
      })()
    })

    const llm = new OpenAILLMClient({
      apiKey: 'k',
      modelByProfile: { fast: 'fast-model', writer: 'writer-model', reasoning: 'reasoning-model' }
    })

    const out: unknown[] = []
    for await (const chunk of llm.stream({
      profile: 'fast',
      messages: [{ role: 'user', content: 'hi' }]
    })) {
      out.push(chunk)
    }

    expect(out.length).toBeGreaterThan(0)
    expect(out[0]).toEqual({ type: 'text', content: 'a' })
    expect(out[1]).toEqual({ type: 'text', content: 'b' })
    const args = mocks.streamText.mock.calls[0]![0] as any
    expect(args.model.modelId).toBe('fast-model')
  })
})
