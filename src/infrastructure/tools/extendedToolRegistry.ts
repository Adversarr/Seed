import type { Tool, ToolRegistry, ToolDefinition, ToolGroup } from '../../core/ports/tool.js'

/**
 * Tool registry with two layers:
 * - static tools: normal `register()` calls (built-ins, local tools)
 * - dynamic tools: externally managed snapshots (for MCP extension)
 *
 * Dynamic tools are replaced by namespace to support refreshes without mutating
 * static registrations.
 */
export class ExtendedToolRegistry implements ToolRegistry {
  readonly #staticTools = new Map<string, Tool>()
  readonly #dynamicToolsByNamespace = new Map<string, Map<string, Tool>>()

  register(tool: Tool): void {
    if (this.#hasDynamicTool(tool.name) || this.#staticTools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`)
    }
    this.#staticTools.set(tool.name, tool)
  }

  /**
   * Replace all dynamic tools under the provided namespace.
   *
   * Example namespace values:
   * - `mcp`
   * - `extension:<id>`
   */
  setDynamicTools(namespace: string, tools: Tool[]): void {
    if (!namespace.trim()) {
      throw new Error('Dynamic namespace cannot be empty')
    }

    const next = new Map<string, Tool>()
    for (const tool of tools) {
      if (next.has(tool.name)) {
        throw new Error(`Duplicate dynamic tool in namespace "${namespace}": ${tool.name}`)
      }

      // Static registrations always take precedence and must stay conflict-free.
      if (this.#staticTools.has(tool.name)) {
        throw new Error(`Dynamic tool conflicts with static tool: ${tool.name}`)
      }

      // Prevent collisions across dynamic namespaces.
      for (const [otherNamespace, otherTools] of this.#dynamicToolsByNamespace) {
        if (otherNamespace === namespace) continue
        if (otherTools.has(tool.name)) {
          throw new Error(`Dynamic tool collision: ${tool.name} already owned by namespace "${otherNamespace}"`)
        }
      }

      next.set(tool.name, tool)
    }

    this.#dynamicToolsByNamespace.set(namespace, next)
  }

  clearDynamicTools(namespace: string): void {
    this.#dynamicToolsByNamespace.delete(namespace)
  }

  get(name: string): Tool | undefined {
    const staticTool = this.#staticTools.get(name)
    if (staticTool) return staticTool

    for (const tools of this.#dynamicToolsByNamespace.values()) {
      const tool = tools.get(name)
      if (tool) return tool
    }

    return undefined
  }

  list(): Tool[] {
    const dynamicTools: Tool[] = []
    const sortedNamespaces = [...this.#dynamicToolsByNamespace.keys()].sort((a, b) => a.localeCompare(b))
    for (const namespace of sortedNamespaces) {
      const tools = this.#dynamicToolsByNamespace.get(namespace)
      if (!tools) continue
      dynamicTools.push(...tools.values())
    }

    return [...this.#staticTools.values(), ...dynamicTools]
  }

  listByGroups(groups: readonly ToolGroup[]): Tool[] {
    const groupSet = new Set(groups)
    return this.list().filter((tool) => groupSet.has(tool.group))
  }

  toOpenAIFormat(): Array<{ type: 'function'; function: ToolDefinition }> {
    return this.#toFormat(this.list())
  }

  toOpenAIFormatByGroups(groups: readonly ToolGroup[]): Array<{ type: 'function'; function: ToolDefinition }> {
    return this.#toFormat(this.listByGroups(groups))
  }

  #toFormat(tools: Tool[]): Array<{ type: 'function'; function: ToolDefinition }> {
    return tools.map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    }))
  }

  #hasDynamicTool(name: string): boolean {
    for (const tools of this.#dynamicToolsByNamespace.values()) {
      if (tools.has(name)) return true
    }
    return false
  }
}
