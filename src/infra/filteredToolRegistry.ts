/**
 * Infrastructure Layer - Filtered Tool Registry
 *
 * A read-only adapter that restricts tool visibility by ToolGroup.
 * Used to scope per-agent tool access without mutating the real registry.
 */

import type { Tool, ToolRegistry, ToolDefinition, ToolGroup } from '../domain/ports/tool.js'

// ============================================================================
// Filtered Tool Registry (per-agent adapter)
// ============================================================================

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
    return this.#inner.list().filter((t) => this.#allowedGroups.has(t.group))
  }

  listByGroups(groups: readonly ToolGroup[]): Tool[] {
    const subSet = new Set(groups)
    return this.list().filter((t) => subSet.has(t.group))
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

/**
 * Create a scoped view of a registry for the given tool groups.
 * If groups is empty, returns an empty registry (no tools visible).
 */
export function createFilteredRegistry(inner: ToolRegistry, groups: readonly ToolGroup[]): ToolRegistry {
  return new FilteredToolRegistry(inner, groups)
}
