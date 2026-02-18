import { describe, expect, it } from 'vitest'
import type { Tool, ToolGroup } from '../../src/core/ports/tool.js'
import { ExtendedToolRegistry } from '../../src/infrastructure/tools/extendedToolRegistry.js'

function createTool(name: string, group: ToolGroup): Tool {
  return {
    name,
    description: `Tool ${name}`,
    parameters: { type: 'object', properties: {} },
    riskLevel: () => 'safe',
    group,
    execute: async () => ({ toolCallId: 't1', output: { ok: true }, isError: false }),
  }
}

describe('ExtendedToolRegistry', () => {
  it('merges static and dynamic tools', () => {
    const registry = new ExtendedToolRegistry()
    registry.register(createTool('static_a', 'search'))

    registry.setDynamicTools('mcp', [
      createTool('mcp__github__issues', 'search'),
      createTool('mcp__github__write', 'exec'),
    ])

    expect(registry.get('static_a')?.name).toBe('static_a')
    expect(registry.get('mcp__github__issues')?.name).toBe('mcp__github__issues')
    expect(registry.list()).toHaveLength(3)
  })

  it('replaces tools by namespace', () => {
    const registry = new ExtendedToolRegistry()

    registry.setDynamicTools('mcp', [
      createTool('mcp__a', 'search'),
    ])
    registry.setDynamicTools('mcp', [
      createTool('mcp__b', 'search'),
    ])

    expect(registry.get('mcp__a')).toBeUndefined()
    expect(registry.get('mcp__b')?.name).toBe('mcp__b')
  })

  it('throws when dynamic tool conflicts with static tool', () => {
    const registry = new ExtendedToolRegistry()
    registry.register(createTool('runCommand', 'exec'))

    expect(() => registry.setDynamicTools('mcp', [
      createTool('runCommand', 'search'),
    ])).toThrow(/conflicts with static tool/)
  })

  it('supports listByGroups and OpenAI formatting for dynamic tools', () => {
    const registry = new ExtendedToolRegistry()
    registry.register(createTool('readFile', 'search'))
    registry.setDynamicTools('mcp', [
      createTool('mcp__read', 'search'),
      createTool('mcp__exec', 'exec'),
    ])

    expect(registry.listByGroups(['search']).map((tool) => tool.name)).toEqual(['readFile', 'mcp__read'])
    expect(registry.toOpenAIFormatByGroups(['exec']).map((item) => item.function.name)).toEqual(['mcp__exec'])
  })
})
