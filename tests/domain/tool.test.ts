import { describe, expect, test } from 'vitest'
import { ToolCallRequestSchema, ToolResultSchema } from '../../src/domain/ports/tool.js'

describe('Tool schemas', () => {
  test('ToolCallRequestSchema parses valid requests', () => {
    const parsed = ToolCallRequestSchema.parse({
      toolCallId: 'call_1',
      toolName: 'readFile',
      arguments: { path: 'README.md' }
    })

    expect(parsed.toolCallId).toBe('call_1')
    expect(parsed.toolName).toBe('readFile')
  })

  test('ToolCallRequestSchema rejects empty values', () => {
    const result = ToolCallRequestSchema.safeParse({
      toolCallId: '',
      toolName: '',
      arguments: {}
    })

    expect(result.success).toBe(false)
  })

  test('ToolResultSchema parses tool results', () => {
    const parsed = ToolResultSchema.parse({
      toolCallId: 'call_2',
      output: { ok: true },
      isError: false
    })

    expect(parsed.isError).toBe(false)
  })

  test('ToolResultSchema rejects missing fields', () => {
    const result = ToolResultSchema.safeParse({
      toolCallId: 'call_3',
      output: { ok: true }
    })

    expect(result.success).toBe(false)
  })
})
