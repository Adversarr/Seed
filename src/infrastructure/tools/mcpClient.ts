import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { Tool as McpListedTool } from '@modelcontextprotocol/sdk/types.js'
import type {
  McpProfileCatalogConfig,
  McpServerConfig,
  McpServerTransportConfig,
} from '../../config/mcpProfileCatalog.js'
import type { Tool } from '../../core/ports/tool.js'
import {
  assignUniqueMcpToolNames,
  createMcpTool,
  type McpRemoteToolDescriptor,
  type McpToolCallResultPayload,
} from './mcpTool.js'

const MCP_EXTENSION_NAMESPACE = 'mcp'
const MCP_CLOSE_TIMEOUT_MS = 1_000

type McpClientLike = {
  connect: (transport: Transport) => Promise<void>
  listTools: (params?: { cursor?: string }) => Promise<{ tools: McpListedTool[]; nextCursor?: string }>
  callTool: (params: { name: string; arguments?: Record<string, unknown> }) => Promise<{
    content?: unknown
    structuredContent?: unknown
    isError?: boolean
    _meta?: Record<string, unknown>
  }>
  close: () => Promise<void>
}

type ActiveMcpServer = {
  id: string
  config: McpServerConfig
  client: McpClientLike
  transport: Transport
  tools: Array<{
    name: string
    description: string
    inputSchema: Record<string, unknown>
    readOnlyHint: boolean
  }>
}

export type McpToolExtensionManagerOptions = {
  config: McpProfileCatalogConfig
  onToolsChanged: (namespace: string, tools: Tool[]) => void
  onWarn?: (message: string) => void
  clientFactory?: (serverId: string, onToolsListChanged: () => void) => McpClientLike
  transportFactory?: (serverId: string, transport: McpServerTransportConfig) => Transport
}

/**
 * MCP extension manager.
 *
 * Responsibilities:
 * - connect enabled MCP servers
 * - discover and filter tool lists
 * - refresh tools when server emits list-changed notifications
 * - expose wrapped Seed tools through a callback
 */
export class McpToolExtensionManager {
  readonly #config: McpProfileCatalogConfig
  readonly #onToolsChanged: (namespace: string, tools: Tool[]) => void
  readonly #warn: (message: string) => void
  readonly #clientFactory?: (serverId: string, onToolsListChanged: () => void) => McpClientLike
  readonly #transportFactory?: (serverId: string, transport: McpServerTransportConfig) => Transport

  readonly #activeServers = new Map<string, ActiveMcpServer>()
  readonly #refreshQueueByServer = new Map<string, Promise<void>>()

  constructor(opts: McpToolExtensionManagerOptions) {
    this.#config = opts.config
    this.#onToolsChanged = opts.onToolsChanged
    this.#warn = opts.onWarn ?? ((message: string) => console.warn(message))
    this.#clientFactory = opts.clientFactory
    this.#transportFactory = opts.transportFactory
  }

  async start(): Promise<void> {
    const entries = Object.entries(this.#config.servers).sort(([left], [right]) => left.localeCompare(right))

    for (const [serverId, serverConfig] of entries) {
      if (!serverConfig.enabled) continue

      try {
        await this.#connectServer(serverId, serverConfig)
      } catch (error) {
        this.#warn(`[mcp] server "${serverId}" disabled due to startup failure: ${toErrorMessage(error)}`)
      }
    }

    this.#publishTools()
  }

  async stop(): Promise<void> {
    const closers = [...this.#activeServers.values()].map(async (server) => {
      await this.#closeConnection(server.id, server.client, server.transport)
    })

    await Promise.all(closers)
    this.#activeServers.clear()
    this.#publishTools()
  }

  async invokeTool(input: {
    serverId: string
    remoteToolName: string
    arguments: Record<string, unknown>
  }): Promise<McpToolCallResultPayload> {
    const active = this.#activeServers.get(input.serverId)
    if (!active) {
      throw new Error(`MCP server is unavailable: ${input.serverId}`)
    }

    const response = await withTimeout(
      active.config.toolTimeoutMs,
      `MCP tool call timed out after ${active.config.toolTimeoutMs}ms (${input.serverId}/${input.remoteToolName})`,
      () => active.client.callTool({
        name: input.remoteToolName,
        arguments: input.arguments,
      }),
    )

    return {
      content: response.content,
      structuredContent: response.structuredContent,
      isError: response.isError,
      _meta: response._meta,
    }
  }

  async #connectServer(serverId: string, serverConfig: McpServerConfig): Promise<void> {
    const transport = this.#createTransport(serverId, serverConfig.transport)
    const client = this.#createClient(serverId)

    try {
      await withTimeout(
        serverConfig.startupTimeoutMs,
        `MCP server startup timed out after ${serverConfig.startupTimeoutMs}ms (${serverId})`,
        () => client.connect(transport),
      )

      this.#activeServers.set(serverId, {
        id: serverId,
        config: serverConfig,
        client,
        transport,
        tools: [],
      })

      await this.#refreshServerTools(serverId, 'startup')
    } catch (error) {
      await this.#closeConnection(serverId, client, transport)
      throw error
    }
  }

  #createClient(serverId: string): McpClientLike {
    if (this.#clientFactory) {
      return this.#clientFactory(serverId, () => {
        void this.#enqueueRefresh(serverId, 'list_changed')
      })
    }

    return new Client(
      { name: 'seed-mcp-client', version: '1.0.0' },
      {
        capabilities: {},
        listChanged: {
          tools: {
            autoRefresh: true,
            debounceMs: 300,
            onChanged: (error) => {
              if (error) {
                this.#warn(`[mcp] list-change callback error from "${serverId}": ${toErrorMessage(error)}`)
                return
              }
              void this.#enqueueRefresh(serverId, 'list_changed')
            },
          },
        },
      },
    )
  }

  #createTransport(serverId: string, transport: McpServerTransportConfig): Transport {
    if (this.#transportFactory) {
      return this.#transportFactory(serverId, transport)
    }

    if (transport.type === 'stdio') {
      const env = {
        ...stringifyProcessEnv(process.env),
        ...resolveStringRecordTemplates(serverId, transport.env, this.#warn),
      }

      return new StdioClientTransport({
        command: transport.command,
        args: transport.args,
        cwd: transport.cwd ?? undefined,
        env,
      })
    }

    if (transport.type === 'streamable_http') {
      const headers = resolveStringRecordTemplates(serverId, transport.headers, this.#warn)
      const requestInit: RequestInit | undefined = Object.keys(headers).length > 0
        ? { headers }
        : undefined

      return new StreamableHTTPClientTransport(new URL(transport.url), {
        requestInit,
        sessionId: transport.sessionId ?? undefined,
      })
    }

    const headers = resolveStringRecordTemplates(serverId, transport.headers, this.#warn)
    const requestInit: RequestInit | undefined = Object.keys(headers).length > 0
      ? { headers }
      : undefined

    return new SSEClientTransport(new URL(transport.url), {
      requestInit,
      eventSourceInit: Object.keys(headers).length > 0
        ? {
            fetch: async (input, init) => {
              return fetch(input, {
                ...init,
                headers: mergeHeaders(init?.headers, headers),
              })
            },
          }
        : undefined,
    })
  }

  async #enqueueRefresh(serverId: string, reason: 'startup' | 'list_changed'): Promise<void> {
    const previous = this.#refreshQueueByServer.get(serverId) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(() => this.#refreshServerTools(serverId, reason))

    this.#refreshQueueByServer.set(serverId, next)
    await next
  }

  async #refreshServerTools(serverId: string, reason: 'startup' | 'list_changed'): Promise<void> {
    const active = this.#activeServers.get(serverId)
    if (!active) return

    try {
      const discovered = await this.#listToolsPaginated(active)
      active.tools = applyToolFilters(discovered, active.config)
      this.#publishTools()
    } catch (error) {
      this.#warn(`[mcp] failed to refresh tools for "${serverId}" (${reason}): ${toErrorMessage(error)}`)
      // Soft-fail behavior: keep previous tool snapshot.
    }
  }

  async #listToolsPaginated(active: ActiveMcpServer): Promise<Array<{
    name: string
    description: string
    inputSchema: Record<string, unknown>
    readOnlyHint: boolean
  }>> {
    const byName = new Map<string, {
      name: string
      description: string
      inputSchema: Record<string, unknown>
      readOnlyHint: boolean
    }>()

    let cursor: string | undefined

    do {
      const response = await withTimeout(
        active.config.startupTimeoutMs,
        `MCP tools/list timed out after ${active.config.startupTimeoutMs}ms (${active.id})`,
        () => active.client.listTools(cursor ? { cursor } : undefined),
      )

      for (const tool of response.tools) {
        byName.set(tool.name, {
          name: tool.name,
          description: tool.description ?? `MCP tool ${tool.name} from server ${active.id}`,
          inputSchema: normalizeInputSchema(tool.inputSchema),
          readOnlyHint: tool.annotations?.readOnlyHint === true,
        })
      }

      cursor = response.nextCursor
    } while (cursor)

    return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name))
  }

  #publishTools(): void {
    const descriptors: McpRemoteToolDescriptor[] = []

    for (const [serverId, server] of [...this.#activeServers.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      for (const tool of server.tools) {
        descriptors.push({
          serverId,
          remoteName: tool.name,
          localName: '',
          description: tool.description,
          inputSchema: tool.inputSchema,
          readOnlyHint: tool.readOnlyHint,
          risk: server.config.risk,
        })
      }
    }

    // Ensure deterministic local names + deterministic collision handling.
    const names = assignUniqueMcpToolNames(
      descriptors.map((entry) => ({ serverId: entry.serverId, remoteToolName: entry.remoteName })),
    )

    for (let i = 0; i < descriptors.length; i++) {
      descriptors[i]!.localName = names[i]!
    }

    const wrapped = descriptors.map((descriptor) => createMcpTool(descriptor, async (resolvedDescriptor, args) => {
      return this.invokeTool({
        serverId: resolvedDescriptor.serverId,
        remoteToolName: resolvedDescriptor.remoteName,
        arguments: args,
      })
    }))

    this.#onToolsChanged(MCP_EXTENSION_NAMESPACE, wrapped)
  }

  async #closeConnection(serverId: string, client: McpClientLike, transport: Transport): Promise<void> {
    try {
      await withTimeout(
        MCP_CLOSE_TIMEOUT_MS,
        `MCP client close timed out after ${MCP_CLOSE_TIMEOUT_MS}ms (${serverId})`,
        () => client.close(),
      )
    } catch (error) {
      this.#warn(`[mcp] failed to close client for "${serverId}": ${toErrorMessage(error)}`)
    }

    try {
      await withTimeout(
        MCP_CLOSE_TIMEOUT_MS,
        `MCP transport close timed out after ${MCP_CLOSE_TIMEOUT_MS}ms (${serverId})`,
        () => transport.close(),
      )
    } catch (error) {
      this.#warn(`[mcp] failed to close transport for "${serverId}": ${toErrorMessage(error)}`)
    }
  }
}

function applyToolFilters(
  tools: Array<{
    name: string
    description: string
    inputSchema: Record<string, unknown>
    readOnlyHint: boolean
  }>,
  config: McpServerConfig,
): Array<{
  name: string
  description: string
  inputSchema: Record<string, unknown>
  readOnlyHint: boolean
}> {
  const includeSet = new Set(config.includeTools)
  const excludeSet = new Set(config.excludeTools)

  if (includeSet.size > 0) {
    return tools.filter((tool) => includeSet.has(tool.name))
  }

  if (excludeSet.size === 0) {
    return tools
  }

  return tools.filter((tool) => !excludeSet.has(tool.name))
}

function normalizeInputSchema(raw: unknown): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { type: 'object', properties: {} }
  }
  return raw as Record<string, unknown>
}

function stringifyProcessEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (typeof value === 'string') {
      result[key] = value
    }
  }
  return result
}

function resolveStringRecordTemplates(
  serverId: string,
  values: Record<string, string>,
  onWarn: (message: string) => void,
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(values)) {
    result[key] = value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, variableName: string) => {
      const resolved = process.env[variableName]
      if (resolved === undefined) {
        onWarn(`[mcp] server "${serverId}" missing env variable: ${variableName}`)
        return ''
      }
      return resolved
    })
  }
  return result
}

function mergeHeaders(
  baseHeaders: unknown,
  override: Record<string, string>,
): Headers {
  const merged = new Headers()

  if (baseHeaders instanceof Headers) {
    for (const [key, value] of baseHeaders.entries()) {
      merged.set(key, value)
    }
  } else if (Array.isArray(baseHeaders)) {
    for (const pair of baseHeaders) {
      if (!Array.isArray(pair) || pair.length !== 2) continue
      const [key, value] = pair
      if (typeof key === 'string' && typeof value === 'string') {
        merged.set(key, value)
      }
    }
  } else if (baseHeaders && typeof baseHeaders === 'object') {
    for (const [key, value] of Object.entries(baseHeaders as Record<string, unknown>)) {
      if (typeof value === 'string') {
        merged.set(key, value)
      }
    }
  }

  for (const [key, value] of Object.entries(override)) {
    merged.set(key, value)
  }
  return merged
}

async function withTimeout<T>(
  timeoutMs: number,
  timeoutMessage: string,
  task: () => Promise<T>,
): Promise<T> {
  if (timeoutMs <= 0) {
    return task()
  }

  let timer: NodeJS.Timeout | undefined

  try {
    return await Promise.race([
      task(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
