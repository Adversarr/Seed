/**
 * Tests for tool argument schema validation (B5).
 *
 * Validates that validateToolArgs correctly checks required fields,
 * type matching, enum validation, nested objects, and arrays.
 */

import { describe, it, expect } from 'vitest'
import { validateToolArgs } from '../../src/infrastructure/tools/toolSchemaValidator.js'
import type { ToolParametersSchema } from '../../src/core/ports/tool.js'

describe('validateToolArgs (B5)', () => {
  const schema: ToolParametersSchema = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
      limit: { type: 'number', description: 'Max results' },
      recursive: { type: 'boolean', description: 'Recursive search' },
      mode: { type: 'string', description: 'Mode', enum: ['fast', 'thorough'] },
      tags: { type: 'array', description: 'Tags', items: { type: 'string' } },
      options: {
        type: 'object',
        description: 'Options',
        properties: {
          verbose: { type: 'boolean', description: 'Verbose output' }
        },
        required: ['verbose']
      },
      count: { type: 'integer', description: 'Count' }
    },
    required: ['query']
  }

  // ── Valid cases ──

  it('returns null for valid args with all required fields', () => {
    expect(validateToolArgs({ query: 'hello' }, schema)).toBeNull()
  })

  it('returns null for valid args with optional fields', () => {
    expect(validateToolArgs({ query: 'hello', limit: 10, recursive: true }, schema)).toBeNull()
  })

  it('returns null for valid enum value', () => {
    expect(validateToolArgs({ query: 'hello', mode: 'fast' }, schema)).toBeNull()
  })

  it('returns null for valid array of strings', () => {
    expect(validateToolArgs({ query: 'hello', tags: ['a', 'b'] }, schema)).toBeNull()
  })

  it('returns null for valid nested object', () => {
    expect(validateToolArgs({ query: 'hello', options: { verbose: true } }, schema)).toBeNull()
  })

  it('allows extra properties not in schema', () => {
    expect(validateToolArgs({ query: 'hello', extraField: 'ignored' }, schema)).toBeNull()
  })

  // ── Missing required ──

  it('returns error for missing required field', () => {
    const err = validateToolArgs({}, schema)
    expect(err).toContain("Missing required argument: 'query'")
  })

  it('returns error for undefined required field', () => {
    const err = validateToolArgs({ query: undefined }, schema)
    expect(err).toContain("Missing required argument: 'query'")
  })

  // ── Type mismatches ──

  it('returns error for wrong type (number instead of string)', () => {
    const err = validateToolArgs({ query: 123 }, schema)
    expect(err).toContain("must be a string")
  })

  it('returns error for wrong type (string instead of number)', () => {
    const err = validateToolArgs({ query: 'hello', limit: 'ten' }, schema)
    expect(err).toContain("must be a number")
  })

  it('returns error for wrong type (string instead of boolean)', () => {
    const err = validateToolArgs({ query: 'hello', recursive: 'yes' }, schema)
    expect(err).toContain("must be a boolean")
  })

  it('returns error for wrong type (object instead of array)', () => {
    const err = validateToolArgs({ query: 'hello', tags: { a: 1 } }, schema)
    expect(err).toContain("must be an array")
  })

  it('returns error for wrong type (array instead of object)', () => {
    const err = validateToolArgs({ query: 'hello', options: ['verbose'] }, schema)
    expect(err).toContain("must be an object")
  })

  it('returns error for non-integer when integer required', () => {
    const err = validateToolArgs({ query: 'hello', count: 3.14 }, schema)
    expect(err).toContain("must be an integer")
  })

  // ── Enum validation ──

  it('returns error for invalid enum value', () => {
    const err = validateToolArgs({ query: 'hello', mode: 'invalid' }, schema)
    expect(err).toContain("must be one of")
    expect(err).toContain('fast')
    expect(err).toContain('thorough')
  })

  // ── Array item validation ──

  it('returns error for wrong item type in array', () => {
    const err = validateToolArgs({ query: 'hello', tags: ['ok', 42] }, schema)
    expect(err).toContain("must be a string")
    expect(err).toContain("tags[1]")
  })

  // ── Nested object validation ──

  it('returns error for missing required field in nested object', () => {
    const err = validateToolArgs({ query: 'hello', options: {} }, schema)
    expect(err).toContain("Missing required field 'verbose'")
  })

  it('returns error for wrong type in nested object', () => {
    const err = validateToolArgs({ query: 'hello', options: { verbose: 'yes' } }, schema)
    expect(err).toContain("must be a boolean")
  })

  // ── Edge cases ──

  it('returns error for non-object args', () => {
    const err = validateToolArgs(null as any, schema)
    expect(err).toContain('Arguments must be an object')
  })

  it('returns null for empty schema (no required, no properties)', () => {
    const emptySchema: ToolParametersSchema = { type: 'object', properties: {} }
    expect(validateToolArgs({ anything: 'goes' }, emptySchema)).toBeNull()
  })

  it('returns null when optional fields are omitted', () => {
    expect(validateToolArgs({ query: 'hello' }, schema)).toBeNull()
  })

  it('skips local validation for advanced JSON schema shapes', () => {
    const advancedSchema: ToolParametersSchema = {
      oneOf: [
        { type: 'object', properties: { path: { type: 'string' } } },
        { type: 'object', properties: { id: { type: 'number' } } },
      ],
    }

    expect(validateToolArgs({ unexpected: 1 }, advancedSchema)).toBeNull()
  })
})
