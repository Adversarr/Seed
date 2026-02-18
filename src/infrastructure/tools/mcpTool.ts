import { nanoid } from 'nanoid'
import type { Tool, ToolContext, ToolResult, ToolRiskLevel } from '../../core/ports/tool.js'
import type { McpServerRiskConfig } from '../../config/mcpProfileCatalog.js'

export type McpRemoteToolDescriptor = {
  serverId: string
  remoteName: string
  localName: string
  description: string
  inputSchema: Record<string, unknown>
  readOnlyHint: boolean
  risk: McpServerRiskConfig
}

export type McpToolCallResultPayload = {
  content?: unknown
  structuredContent?: unknown
  isError?: boolean
  _meta?: Record<string, unknown>
}

export type InvokeMcpTool = (
  descriptor: McpRemoteToolDescriptor,
  args: Record<string, unknown>,
  ctx: ToolContext
) => Promise<McpToolCallResultPayload>

/**
 * Build a deterministic MCP tool name in `mcp__<server>__<tool>` format.
 */
export function buildBaseMcpToolName(serverId: string, remoteToolName: string): string {
  return `mcp__${sanitizeMcpNameSegment(serverId)}__${sanitizeMcpNameSegment(remoteToolName)}`
}

/**
 * Make MCP tool names filesystem/identifier friendly while staying deterministic.
 */
export function sanitizeMcpNameSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

  return normalized.length > 0 ? normalized : 'tool'
}

/**
 * Resolve collisions deterministically by appending a numeric suffix.
 */
export function assignUniqueMcpToolNames(entries: Array<{ serverId: string; remoteToolName: string }>): string[] {
  const used = new Map<string, number>()
  return entries.map((entry) => {
    const base = buildBaseMcpToolName(entry.serverId, entry.remoteToolName)
    const seen = used.get(base) ?? 0
    used.set(base, seen + 1)
    return seen === 0 ? base : `${base}__${seen + 1}`
  })
}

/**
 * Convert a remote MCP tool into a local Seed Tool implementation.
 */
export function createMcpTool(
  descriptor: McpRemoteToolDescriptor,
  invoke: InvokeMcpTool,
): Tool {
  const defaultRisk = evaluateMcpRisk(descriptor)

  return {
    name: descriptor.localName,
    description: descriptor.description,
    parameters: descriptor.inputSchema,
    // Default grouping follows risk classification.
    group: defaultRisk === 'safe' ? 'search' : 'exec',
    riskLevel: () => evaluateMcpRisk(descriptor),
    async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const toolCallId = `tool_${nanoid(12)}`

      try {
        const response = await invoke(descriptor, args, ctx)
        const isError = response.isError === true

        return {
          toolCallId,
          output: {
            serverId: descriptor.serverId,
            remoteToolName: descriptor.remoteName,
            content: response.content ?? [],
            structuredContent: response.structuredContent,
            _meta: response._meta,
          },
          isError,
        }
      } catch (error) {
        return {
          toolCallId,
          output: {
            serverId: descriptor.serverId,
            remoteToolName: descriptor.remoteName,
            error: error instanceof Error ? error.message : String(error),
          },
          isError: true,
        }
      }
    },
  }
}

function evaluateMcpRisk(descriptor: Pick<McpRemoteToolDescriptor, 'remoteName' | 'readOnlyHint' | 'risk'>): ToolRiskLevel {
  const safeTools = new Set(descriptor.risk.safeTools)
  if (safeTools.has(descriptor.remoteName)) {
    return 'safe'
  }

  if (descriptor.risk.safeReadOnlyHint && descriptor.readOnlyHint) {
    return 'safe'
  }

  return descriptor.risk.default
}
