import { z } from 'zod'

export type McpRiskLevel = 'safe' | 'risky'

export type McpServerRiskConfig = {
  default: McpRiskLevel
  safeReadOnlyHint: boolean
  safeTools: string[]
}

export type McpStdioTransportConfig = {
  type: 'stdio'
  command: string
  args: string[]
  env: Record<string, string>
  cwd: string | null
}

export type McpStreamableHttpTransportConfig = {
  type: 'streamable_http'
  url: string
  headers: Record<string, string>
  sessionId: string | null
}

export type McpSseTransportConfig = {
  type: 'sse'
  url: string
  headers: Record<string, string>
}

export type McpServerTransportConfig =
  | McpStdioTransportConfig
  | McpStreamableHttpTransportConfig
  | McpSseTransportConfig

export type McpServerConfig = {
  enabled: boolean
  transport: McpServerTransportConfig
  startupTimeoutMs: number
  toolTimeoutMs: number
  includeTools: string[]
  excludeTools: string[]
  risk: McpServerRiskConfig
}

export type McpProfileCatalogConfig = {
  servers: Record<string, McpServerConfig>
}

const McpRiskConfigSchema = z.object({
  default: z.enum(['safe', 'risky']).default('risky'),
  safeReadOnlyHint: z.boolean().default(false),
  safeTools: z.array(z.string().min(1)).default([]),
}).strict()

const McpStdioTransportConfigSchema = z.object({
  type: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  env: z.record(z.string().min(1), z.string()).default({}),
  cwd: z.string().min(1).nullable().default(null),
}).strict()

const McpStreamableHttpTransportConfigSchema = z.object({
  type: z.literal('streamable_http'),
  url: z.string().url(),
  headers: z.record(z.string().min(1), z.string()).default({}),
  sessionId: z.string().min(1).nullable().default(null),
}).strict()

const McpSseTransportConfigSchema = z.object({
  type: z.literal('sse'),
  url: z.string().url(),
  headers: z.record(z.string().min(1), z.string()).default({}),
}).strict()

const McpServerTransportConfigSchema = z.discriminatedUnion('type', [
  McpStdioTransportConfigSchema,
  McpStreamableHttpTransportConfigSchema,
  McpSseTransportConfigSchema,
])

const McpServerConfigSchema = z.object({
  enabled: z.boolean().default(true),
  transport: McpServerTransportConfigSchema,
  startupTimeoutMs: z.number().int().min(1).default(10_000),
  toolTimeoutMs: z.number().int().min(1).default(60_000),
  includeTools: z.array(z.string().min(1)).default([]),
  excludeTools: z.array(z.string().min(1)).default([]),
  risk: McpRiskConfigSchema.default({ default: 'risky', safeReadOnlyHint: false, safeTools: [] }),
}).strict()

const McpProfileCatalogConfigSchema = z.object({
  servers: z.record(z.string().min(1), McpServerConfigSchema).default({}),
}).strict()

export function createDefaultMcpProfileCatalogConfig(): McpProfileCatalogConfig {
  return {
    servers: {},
  }
}

/**
 * Validate an MCP profile catalog from arbitrary JSON-like input.
 */
export function parseMcpProfileCatalogConfigFromInput(opts: {
  input: unknown
  sourceName: string
}): McpProfileCatalogConfig {
  const result = McpProfileCatalogConfigSchema.safeParse(opts.input)
  if (!result.success) {
    const message = result.error.issues
      .map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`)
      .join('; ')
    throw new Error(`${opts.sourceName} validation failed: ${message}`)
  }

  return result.data
}
