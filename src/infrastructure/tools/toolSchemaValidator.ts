/**
 * Tool Argument Schema Validator
 *
 * Validates tool arguments against the tool's JSON Schema parameter definition.
 * Returns null if valid, or an error message string if invalid.
 */

import type { ToolParametersSchema, JsonSchemaProperty } from '../../core/ports/tool.js'

/**
 * Validate tool arguments against the tool's JSON Schema.
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

  // Check required fields
  if (schema.required) {
    for (const field of schema.required) {
      if (!(field in args) || args[field] === undefined) {
        return `Missing required argument: '${field}'`
      }
    }
  }

  // Check each provided argument against the schema
  for (const [key, value] of Object.entries(args)) {
    const propSchema = schema.properties[key]
    if (!propSchema) {
      // Extra properties are allowed (tools may ignore them)
      continue
    }

    const error = validateProperty(key, value, propSchema)
    if (error) return error
  }

  return null
}

function validateProperty(name: string, value: unknown, schema: JsonSchemaProperty): string | null {
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
