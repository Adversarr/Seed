import { describe, expect, it, vi } from 'vitest'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import type { McpProfileCatalogConfig, McpServerConfig } from '../../src/config/mcpProfileCatalog.js'
import { McpToolExtensionManager } from '../../src/infrastructure/tools/mcpClient.js'

function serverConfig(overrides?: Partial<McpServerConfig>): McpServerConfig {
  return {
    enabled: true,
    transport: {
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
      env: {},
      cwd: null,
    },
    startupTimeoutMs: 100,
    toolTimeoutMs: 100,
    includeTools: [],
    excludeTools: [],
    risk: {
      default: 'risky',
      safeReadOnlyHint: false,
      safeTools: [],
    },
    ...overrides,
  }
}

function config(servers: Record<string, McpServerConfig>): McpProfileCatalogConfig {
  return { servers }
}

function noopTransport(): Transport {
  return {
    start: async () => {},
    send: async () => {},
    close: async () => {},
  }
}

describe('McpToolExtensionManager', () => {
  it('soft-fails broken servers and still publishes tools from healthy ones', async () => {
    const warnings: string[] = []
    let publishedTools: string[] = []

    const manager = new McpToolExtensionManager({
      config: config({
        good: serverConfig(),
        bad: serverConfig(),
      }),
      onWarn: (message) => warnings.push(message),
      onToolsChanged: (_namespace, tools) => {
        publishedTools = tools.map((tool) => tool.name)
      },
      transportFactory: () => noopTransport(),
      clientFactory: (serverId) => {
        if (serverId === 'bad') {
          return {
            connect: async () => {
              throw new Error('connect failed')
            },
            listTools: async () => ({ tools: [] }),
            callTool: async () => ({ content: [], isError: false }),
            close: async () => {},
          }
        }

        return {
          connect: async () => {},
          listTools: async () => ({
            tools: [
              {
                name: 'read',
                description: 'read tool',
                inputSchema: { type: 'object', properties: {} },
                annotations: { readOnlyHint: true },
              },
            ],
          }),
          callTool: async () => ({ content: [], isError: false }),
          close: async () => {},
        }
      },
    })

    await manager.start()

    expect(publishedTools).toEqual(['mcp__good__read'])
    expect(warnings.some((warning) => warning.includes('bad'))).toBe(true)
  })

  it('supports pagination and includeTools precedence over excludeTools', async () => {
    let publishedTools: string[] = []
    const listTools = vi.fn(async (params?: { cursor?: string }) => {
      if (!params?.cursor) {
        return {
          tools: [
            {
              name: 'keep',
              description: 'keep page 1',
              inputSchema: { type: 'object', properties: {} },
              annotations: { readOnlyHint: true },
            },
            {
              name: 'drop',
              description: 'drop',
              inputSchema: { type: 'object', properties: {} },
              annotations: { readOnlyHint: false },
            },
          ],
          nextCursor: 'p2',
        }
      }

      return {
        tools: [
          {
            name: 'keep',
            description: 'keep page 2',
            inputSchema: { type: 'object', properties: {} },
            annotations: { readOnlyHint: true },
          },
        ],
      }
    })

    const manager = new McpToolExtensionManager({
      config: config({
        srv: serverConfig({
          includeTools: ['keep'],
          excludeTools: ['keep', 'drop'],
        }),
      }),
      onToolsChanged: (_namespace, tools) => {
        publishedTools = tools.map((tool) => tool.name)
      },
      transportFactory: () => noopTransport(),
      clientFactory: () => ({
        connect: async () => {},
        listTools,
        callTool: async () => ({ content: [], isError: false }),
        close: async () => {},
      }),
    })

    await manager.start()

    expect(listTools).toHaveBeenCalledTimes(2)
    expect(publishedTools).toEqual(['mcp__srv__keep'])
  })

  it('cleans up client and transport when startup times out', async () => {
    const clientClose = vi.fn(async () => {})
    const transportClose = vi.fn(async () => {})

    const manager = new McpToolExtensionManager({
      config: config({
        srv: serverConfig({
          startupTimeoutMs: 10,
        }),
      }),
      onToolsChanged: () => {},
      transportFactory: () => ({
        start: async () => {},
        send: async () => {},
        close: transportClose,
      }),
      clientFactory: () => ({
        connect: async () => new Promise(() => {}),
        listTools: async () => ({ tools: [] }),
        callTool: async () => ({ content: [], isError: false }),
        close: clientClose,
      }),
    })

    await manager.start()

    expect(clientClose).toHaveBeenCalledTimes(1)
    expect(transportClose).toHaveBeenCalledTimes(1)
  })

  it('applies tool call timeout', async () => {
    const manager = new McpToolExtensionManager({
      config: config({
        srv: serverConfig({
          toolTimeoutMs: 10,
        }),
      }),
      onToolsChanged: () => {},
      transportFactory: () => noopTransport(),
      clientFactory: () => ({
        connect: async () => {},
        listTools: async () => ({
          tools: [
            {
              name: 'slow',
              description: 'slow tool',
              inputSchema: { type: 'object', properties: {} },
              annotations: { readOnlyHint: false },
            },
          ],
        }),
        callTool: async () => new Promise(() => {}),
        close: async () => {},
      }),
    })

    await manager.start()

    await expect(manager.invokeTool({
      serverId: 'srv',
      remoteToolName: 'slow',
      arguments: {},
    })).rejects.toThrow(/timed out/)
  })

  it('refreshes tools when list-change callback fires', async () => {
    let currentTools = [
      {
        name: 'first',
        description: 'first tool',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: false },
      },
    ]

    let onToolsListChanged: (() => void) | undefined
    let publishedTools: string[] = []

    const manager = new McpToolExtensionManager({
      config: config({ srv: serverConfig() }),
      onToolsChanged: (_namespace, tools) => {
        publishedTools = tools.map((tool) => tool.name)
      },
      transportFactory: () => noopTransport(),
      clientFactory: (_serverId, callback) => {
        onToolsListChanged = callback
        return {
          connect: async () => {},
          listTools: async () => ({ tools: currentTools }),
          callTool: async () => ({ content: [], isError: false }),
          close: async () => {},
        }
      },
    })

    await manager.start()
    expect(publishedTools).toEqual(['mcp__srv__first'])

    currentTools = [
      {
        name: 'second',
        description: 'second tool',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: false },
      },
    ]

    onToolsListChanged?.()
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(publishedTools).toEqual(['mcp__srv__second'])
  })
})
