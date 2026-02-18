/**
 * Tool Argument Schema Validator
 *
 * Validates tool arguments against simple object-style schemas used by built-in
 * tools. Rich JSON schemas (for example MCP-provided schemas with oneOf/refs)
 * are passed through without local validation and delegated to the remote tool.
 */

import type {
  ToolParametersSchema,
  SimpleToolParametersSchema,
  SimpleJsonSchemaProperty,
} from '../../core/ports/tool.js'

/**
 * Validate tool arguments against the tool's JSON schema.
 *
 * @param args - The arguments to validate
 * @param schema - The tool's parameter schema
 * @returns null if valid, error message if invalid
 */
export function validateToolArgs(
  args: Record<string, unknown>,
  schema: ToolParametersSchema
): string | null {
  if (!args || typeof args !== 'object') {
    return 'Arguments must be an object'
  }

  const simpleSchema = toSimpleToolParametersSchema(schema)
  if (!simpleSchema) {
    // Unknown/advanced schema shape: skip local validation.
    return null
  }

  // Check required fields
  if (simpleSchema.required) {
    for (const field of simpleSchema.required) {
      if (!(field in args) || args[field] === undefined) {
        return `Missing required argument: '${field}'`
      }
    }
  }

  // Check each provided argument against the schema
  for (const [key, value] of Object.entries(args)) {
    const propSchema = simpleSchema.properties[key]
    if (!propSchema) {
      // Extra properties are allowed (tools may ignore them)
      continue
    }

    const error = validateProperty(key, value, propSchema)
    if (error) return error
  }

  return null
}

function toSimpleToolParametersSchema(schema: ToolParametersSchema): SimpleToolParametersSchema | null {
  if (!schema || typeof schema !== 'object') return null

  const record = schema as Record<string, unknown>
  if (record.type !== 'object') return null

  const properties = record.properties
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    return null
  }

  const normalizedProperties: Record<string, SimpleJsonSchemaProperty> = {}
  for (const [key, rawProperty] of Object.entries(properties)) {
    const normalized = toSimpleJsonSchemaProperty(rawProperty)
    if (!normalized) return null
    normalizedProperties[key] = normalized
  }

  const rawRequired = record.required
  if (rawRequired !== undefined && !Array.isArray(rawRequired)) {
    return null
  }

  const required = Array.isArray(rawRequired)
    ? rawRequired.filter((item): item is string => typeof item === 'string')
    : undefined

  return {
    type: 'object',
    properties: normalizedProperties,
    ...(required ? { required } : {}),
  }
}

function toSimpleJsonSchemaProperty(raw: unknown): SimpleJsonSchemaProperty | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }

  const record = raw as Record<string, unknown>
  if (typeof record.type !== 'string') {
    return null
  }

  const property: SimpleJsonSchemaProperty = {
    type: record.type,
  }

  if (typeof record.description === 'string') {
    property.description = record.description
  }

  if (Array.isArray(record.enum)) {
    property.enum = record.enum.filter((item): item is string => typeof item === 'string')
  }

  if (record.items !== undefined) {
    const nestedItem = toSimpleJsonSchemaProperty(record.items)
    if (!nestedItem) return null
    property.items = nestedItem
  }

  if (record.properties !== undefined) {
    if (!record.properties || typeof record.properties !== 'object' || Array.isArray(record.properties)) {
      return null
    }
    const nestedProperties: Record<string, SimpleJsonSchemaProperty> = {}
    for (const [nestedKey, nestedRaw] of Object.entries(record.properties)) {
      const nestedProperty = toSimpleJsonSchemaProperty(nestedRaw)
      if (!nestedProperty) return null
      nestedProperties[nestedKey] = nestedProperty
    }
    property.properties = nestedProperties
  }

  if (record.required !== undefined) {
    if (!Array.isArray(record.required)) return null
    property.required = record.required.filter((item): item is string => typeof item === 'string')
  }

  return property
}

function validateProperty(name: string, value: unknown, schema: SimpleJsonSchemaProperty): string | null {
  // null/undefined check for required is handled above; optional undefined is ok
  if (value === undefined || value === null) return null

  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') {
        return `Argument '${name}' must be a string, got ${typeof value}`
      }
      if (schema.enum && !schema.enum.includes(value)) {
        return `Argument '${name}' must be one of: ${schema.enum.join(', ')}`
      }
      break
    case 'number':
    case 'integer':
      if (typeof value !== 'number') {
        return `Argument '${name}' must be a number, got ${typeof value}`
      }
      if (schema.type === 'integer' && !Number.isInteger(value)) {
        return `Argument '${name}' must be an integer`
      }
      break
    case 'boolean':
      if (typeof value !== 'boolean') {
        return `Argument '${name}' must be a boolean, got ${typeof value}`
      }
      break
    case 'array':
      if (!Array.isArray(value)) {
        return `Argument '${name}' must be an array, got ${typeof value}`
      }
      if (schema.items) {
        for (let i = 0; i < value.length; i++) {
          const error = validateProperty(`${name}[${i}]`, value[i], schema.items)
          if (error) return error
        }
      }
      break
    case 'object':
      if (typeof value !== 'object' || Array.isArray(value)) {
        return `Argument '${name}' must be an object, got ${typeof value}`
      }
      if (schema.properties) {
        for (const [subKey, subValue] of Object.entries(value as Record<string, unknown>)) {
          const subSchema = schema.properties[subKey]
          if (subSchema) {
            const error = validateProperty(`${name}.${subKey}`, subValue, subSchema)
            if (error) return error
          }
        }
      }
      if (schema.required) {
        for (const field of schema.required) {
          if (!(field in (value as Record<string, unknown>))) {
            return `Missing required field '${field}' in '${name}'`
          }
        }
      }
      break
  }

  return null
}
