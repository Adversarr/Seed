import type { Tool, ToolRegistry, ToolDefinition, ToolGroup } from '../ports/tool.js'

/**
 * Core Policy - Filtered Tool Registry
 *
 * Read-only adapter that restricts tool visibility by ToolGroup.
 */
export class FilteredToolRegistry implements ToolRegistry {
  readonly #inner: ToolRegistry
  readonly #allowedGroups: ReadonlySet<ToolGroup>

  constructor(inner: ToolRegistry, groups: readonly ToolGroup[]) {
    this.#inner = inner
    this.#allowedGroups = new Set(groups)
  }

  register(_tool: Tool): void {
    throw new Error('FilteredToolRegistry is read-only')
  }

  get(name: string): Tool | undefined {
    const tool = this.#inner.get(name)
    if (!tool) return undefined
    return this.#allowedGroups.has(tool.group) ? tool : undefined
  }

  list(): Tool[] {
    return this.#inner.list().filter((tool) => this.#allowedGroups.has(tool.group))
  }

  listByGroups(groups: readonly ToolGroup[]): Tool[] {
    const subSet = new Set(groups)
    return this.list().filter((tool) => subSet.has(tool.group))
  }

  toOpenAIFormat(): Array<{ type: 'function'; function: ToolDefinition }> {
    return this.list().map((tool) => ({
      type: 'function' as const,
      function: { name: tool.name, description: tool.description, parameters: tool.parameters }
    }))
  }

  toOpenAIFormatByGroups(groups: readonly ToolGroup[]): Array<{ type: 'function'; function: ToolDefinition }> {
    return this.listByGroups(groups).map((tool) => ({
      type: 'function' as const,
      function: { name: tool.name, description: tool.description, parameters: tool.parameters }
    }))
  }
}
