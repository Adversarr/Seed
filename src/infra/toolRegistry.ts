/**
 * Infrastructure Layer - Tool Registry Implementation
 *
 * Manages available tools for Agents.
 */

import type { Tool, ToolRegistry, ToolDefinition } from '../domain/ports/tool.js'

// ============================================================================
// Default Tool Registry Implementation
// ============================================================================

export class DefaultToolRegistry implements ToolRegistry {
  readonly #tools = new Map<string, Tool>()

  register(tool: Tool): void {
    if (this.#tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`)
    }
    this.#tools.set(tool.name, tool)
  }

  get(name: string): Tool | undefined {
    return this.#tools.get(name)
  }

  list(): Tool[] {
    return Array.from(this.#tools.values())
  }

  toOpenAIFormat(): Array<{ type: 'function'; function: ToolDefinition }> {
    return this.list().map((tool) => ({
      type: 'function' as const,
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters
      }
    }))
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createToolRegistry(): ToolRegistry {
  return new DefaultToolRegistry()
}
