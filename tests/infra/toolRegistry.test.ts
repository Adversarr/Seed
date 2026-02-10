import { describe, expect, test } from 'vitest'
import { DefaultToolRegistry } from '../../src/infra/toolRegistry.js'
import { FilteredToolRegistry, createFilteredRegistry } from '../../src/infra/filteredToolRegistry.js'
import type { Tool, ToolGroup } from '../../src/domain/ports/tool.js'

function createTool(name: string, group: ToolGroup): Tool {
  return {
    name,
    description: `Tool ${name}`,
    parameters: { type: 'object', properties: {} },
    riskLevel: 'safe',
    group,
    execute: async () => ({ toolCallId: 't1', output: { ok: true }, isError: false })
  }
}

describe('DefaultToolRegistry', () => {
  test('registers and retrieves tools', () => {
    const registry = new DefaultToolRegistry()
    const tool = createTool('alpha', 'search')

    registry.register(tool)

    expect(registry.get('alpha')).toBe(tool)
    expect(registry.list()).toEqual([tool])
  })

  test('throws on duplicate registration', () => {
    const registry = new DefaultToolRegistry()
    const tool = createTool('alpha', 'search')

    registry.register(tool)

    expect(() => registry.register(tool)).toThrow('Tool already registered: alpha')
  })

  test('filters by group and formats definitions', () => {
    const registry = new DefaultToolRegistry()
    const searchTool = createTool('search_tool', 'search')
    const execTool = createTool('exec_tool', 'exec')

    registry.register(searchTool)
    registry.register(execTool)

    const filtered = registry.listByGroups(['search'])
    expect(filtered).toEqual([searchTool])

    const openAI = registry.toOpenAIFormatByGroups(['exec'])
    expect(openAI).toEqual([
      {
        type: 'function',
        function: {
          name: 'exec_tool',
          description: 'Tool exec_tool',
          parameters: { type: 'object', properties: {} }
        }
      }
    ])
  })
})

describe('FilteredToolRegistry', () => {
  test('exposes only allowed groups', () => {
    const registry = new DefaultToolRegistry()
    const searchTool = createTool('search_tool', 'search')
    const editTool = createTool('edit_tool', 'edit')

    registry.register(searchTool)
    registry.register(editTool)

    const filtered = new FilteredToolRegistry(registry, ['search'])

    expect(filtered.get('search_tool')).toBe(searchTool)
    expect(filtered.get('edit_tool')).toBeUndefined()
    expect(filtered.list()).toEqual([searchTool])
  })

  test('filters by provided subset of groups', () => {
    const registry = new DefaultToolRegistry()
    const searchTool = createTool('search_tool', 'search')
    const execTool = createTool('exec_tool', 'exec')

    registry.register(searchTool)
    registry.register(execTool)

    const filtered = new FilteredToolRegistry(registry, ['search', 'exec'])

    expect(filtered.listByGroups(['exec'])).toEqual([execTool])
    expect(filtered.listByGroups(['edit'])).toEqual([])
  })

  test('formats OpenAI definitions for allowed groups', () => {
    const registry = new DefaultToolRegistry()
    const searchTool = createTool('search_tool', 'search')
    const execTool = createTool('exec_tool', 'exec')

    registry.register(searchTool)
    registry.register(execTool)

    const filtered = new FilteredToolRegistry(registry, ['search'])

    expect(filtered.toOpenAIFormat()).toEqual([
      {
        type: 'function',
        function: {
          name: 'search_tool',
          description: 'Tool search_tool',
          parameters: { type: 'object', properties: {} }
        }
      }
    ])

    expect(filtered.toOpenAIFormatByGroups(['search'])).toHaveLength(1)
    expect(filtered.toOpenAIFormatByGroups(['exec'])).toHaveLength(0)
  })

  test('is read-only', () => {
    const registry = new DefaultToolRegistry()
    const filtered = new FilteredToolRegistry(registry, ['search'])

    expect(() => filtered.register(createTool('new_tool', 'search'))).toThrow('FilteredToolRegistry is read-only')
  })

  test('createFilteredRegistry returns empty view for empty groups', () => {
    const registry = new DefaultToolRegistry()
    registry.register(createTool('search_tool', 'search'))

    const filtered = createFilteredRegistry(registry, [])

    expect(filtered.list()).toEqual([])
  })
})
