import { describe, expect, it } from 'vitest'
import {
  assignUniqueMcpToolNames,
  buildBaseMcpToolName,
  createMcpTool,
  sanitizeMcpNameSegment,
  type McpRemoteToolDescriptor,
} from '../../src/infrastructure/tools/mcpTool.js'

function descriptor(overrides?: Partial<McpRemoteToolDescriptor>): McpRemoteToolDescriptor {
  return {
    serverId: 'GitHub Server',
    remoteName: 'issues.list',
    localName: 'mcp__github_server__issues_list',
    description: 'List issues',
    inputSchema: { type: 'object', properties: {} },
    readOnlyHint: false,
    risk: {
      default: 'risky',
      safeReadOnlyHint: false,
      safeTools: [],
    },
    ...overrides,
  }
}

describe('mcpTool naming', () => {
  it('sanitizes segments deterministically', () => {
    expect(sanitizeMcpNameSegment('GitHub Server')).toBe('github_server')
    expect(sanitizeMcpNameSegment('issues.list')).toBe('issues_list')
    expect(buildBaseMcpToolName('GitHub Server', 'issues.list')).toBe('mcp__github_server__issues_list')
  })

  it('assigns deterministic suffixes for collisions', () => {
    const names = assignUniqueMcpToolNames([
      { serverId: 'A', remoteToolName: 'x' },
      { serverId: 'A', remoteToolName: 'x' },
      { serverId: 'A', remoteToolName: 'x' },
    ])

    expect(names).toEqual([
      'mcp__a__x',
      'mcp__a__x__2',
      'mcp__a__x__3',
    ])
  })
})

describe('createMcpTool risk mapping', () => {
  it('maps default risky tools to exec group', () => {
    const tool = createMcpTool(descriptor(), async () => ({ content: [] }))

    expect(tool.group).toBe('exec')
    expect(tool.riskLevel({}, {} as any)).toBe('risky')
  })

  it('marks read-only tools safe when safeReadOnlyHint is enabled', () => {
    const tool = createMcpTool(descriptor({
      readOnlyHint: true,
      risk: {
        default: 'risky',
        safeReadOnlyHint: true,
        safeTools: [],
      },
    }), async () => ({ content: [] }))

    expect(tool.group).toBe('search')
    expect(tool.riskLevel({}, {} as any)).toBe('safe')
  })

  it('marks listed safeTools as safe', () => {
    const tool = createMcpTool(descriptor({
      remoteName: 'dangerous.write',
      risk: {
        default: 'risky',
        safeReadOnlyHint: false,
        safeTools: ['dangerous.write'],
      },
    }), async () => ({ content: [] }))

    expect(tool.group).toBe('search')
    expect(tool.riskLevel({}, {} as any)).toBe('safe')
  })
})

describe('createMcpTool execute', () => {
  it('returns structured output from invoke callback', async () => {
    const tool = createMcpTool(descriptor(), async () => ({
      content: [{ type: 'text', text: 'ok' }],
      structuredContent: { ok: true },
      isError: false,
    }))

    const result = await tool.execute({}, {} as any)
    const output = result.output as Record<string, unknown>

    expect(result.isError).toBe(false)
    expect(output.serverId).toBe('GitHub Server')
    expect(output.remoteToolName).toBe('issues.list')
    expect(output.structuredContent).toEqual({ ok: true })
  })

  it('converts invoke errors into tool errors', async () => {
    const tool = createMcpTool(descriptor(), async () => {
      throw new Error('boom')
    })

    const result = await tool.execute({}, {} as any)
    const output = result.output as Record<string, unknown>

    expect(result.isError).toBe(true)
    expect(output.error).toBe('boom')
  })
})
