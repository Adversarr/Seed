import { describe, expect, test, vi } from 'vitest'

import { DefaultToolRegistry } from '../../src/infrastructure/tools/toolRegistry.js'
import { registerBuiltinTools } from '../../src/infrastructure/tools/index.js'
import { FakeLLMClient } from '../../src/infrastructure/llm/fakeLLMClient.js'
import { OpenAILLMClient } from '../../src/infrastructure/llm/openaiLLMClient.js'
import { BailianLLMClient } from '../../src/infrastructure/llm/bailianLLMClient.js'
import { VolcengineLLMClient } from '../../src/infrastructure/llm/volcengineLLMClient.js'

function createProfileCatalog(withResearchWeb = true) {
  const profiles: Record<string, { model: string; clientPolicy: string }> = {
    fast: { model: 'fast-model', clientPolicy: 'default' },
    writer: { model: 'writer-model', clientPolicy: 'default' },
    reasoning: { model: 'reasoning-model', clientPolicy: 'default' },
  }

  if (withResearchWeb) {
    profiles.research_web = { model: 'web-model', clientPolicy: 'default' }
  }

  return {
    defaultProfile: 'fast',
    clientPolicies: {
      default: {
        openaiCompat: {
          enableThinking: true,
        },
      },
    },
    profiles,
  }
}

function toolNames(registry: DefaultToolRegistry): string[] {
  return registry.list().map((tool) => tool.name)
}

describe('web tool registration', () => {
  test('does not register web tools for fake/openai providers', () => {
    const fakeRegistry = new DefaultToolRegistry()
    registerBuiltinTools(fakeRegistry, {
      web: {
        llm: new FakeLLMClient(),
        profile: 'research_web',
      },
    })

    const openaiRegistry = new DefaultToolRegistry()
    registerBuiltinTools(openaiRegistry, {
      web: {
        llm: new OpenAILLMClient({
          provider: 'openai',
          apiKey: 'openai-key',
          profileCatalog: createProfileCatalog(),
        }),
        profile: 'research_web',
      },
    })

    expect(toolNames(fakeRegistry)).not.toContain('web_search')
    expect(toolNames(fakeRegistry)).not.toContain('web_fetch')
    expect(toolNames(openaiRegistry)).not.toContain('web_search')
    expect(toolNames(openaiRegistry)).not.toContain('web_fetch')
  })

  test('registers web_search + web_fetch for bailian', () => {
    const registry = new DefaultToolRegistry()
    registerBuiltinTools(registry, {
      web: {
        llm: new BailianLLMClient({
          apiKey: 'bailian-key',
          profileCatalog: createProfileCatalog(),
        }),
        profile: 'research_web',
      },
    })

    const names = toolNames(registry)
    expect(names).toContain('web_search')
    expect(names).toContain('web_fetch')
  })

  test('registers web_search only for volcengine', () => {
    const registry = new DefaultToolRegistry()
    registerBuiltinTools(registry, {
      web: {
        llm: new VolcengineLLMClient({
          apiKey: 'volc-key',
          profileCatalog: createProfileCatalog(),
        }),
        profile: 'research_web',
      },
    })

    const names = toolNames(registry)
    expect(names).toContain('web_search')
    expect(names).not.toContain('web_fetch')
  })

  test('skips web tool registration when research profile is missing', () => {
    const onSkip = vi.fn()
    const registry = new DefaultToolRegistry()

    registerBuiltinTools(registry, {
      web: {
        llm: new BailianLLMClient({
          apiKey: 'bailian-key',
          profileCatalog: createProfileCatalog(false),
        }),
        profile: 'research_web',
        onSkip,
      },
    })

    const names = toolNames(registry)
    expect(names).not.toContain('web_search')
    expect(names).not.toContain('web_fetch')
    expect(onSkip).toHaveBeenCalledOnce()
  })
})
