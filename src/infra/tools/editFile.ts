/**
 * Built-in Tool: editFile
 *
 * Edits a file using string replacement (oldString -> newString).
 * Risk level: risky (requires UIP confirmation)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { mkdirSync } from 'node:fs'
import { nanoid } from 'nanoid'
import type { Tool, ToolContext, ToolResult } from '../../domain/ports/tool.js'

export const editFileTool: Tool = {
  name: 'editFile',
  description: `Edit a file by replacing oldString with newString. For new files, use oldString="" and newString with the full content. The replacement must match exactly (including whitespace).`,
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the file from workspace root'
      },
      oldString: {
        type: 'string',
        description: 'The exact string to replace. Use "" for creating new files.'
      },
      newString: {
        type: 'string',
        description: 'The string to replace oldString with'
      }
    },
    required: ['path', 'oldString', 'newString']
  },
  riskLevel: 'risky',

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const toolCallId = `tool_${nanoid(12)}`
    const path = args.path as string
    const oldString = args.oldString as string
    const newString = args.newString as string

    try {
      const absolutePath = resolve(ctx.baseDir, path)

      // Handle new file creation
      if (oldString === '') {
        if (existsSync(absolutePath)) {
          return {
            toolCallId,
            output: { error: `File already exists: ${path}. Use non-empty oldString to edit.` },
            isError: true
          }
        }
        mkdirSync(dirname(absolutePath), { recursive: true })
        writeFileSync(absolutePath, newString, 'utf8')
        return {
          toolCallId,
          output: { 
            success: true, 
            path, 
            action: 'created'
          },
          isError: false
        }
      }

      // Read existing file
      if (!existsSync(absolutePath)) {
        return {
          toolCallId,
          output: { error: `File not found: ${path}` },
          isError: true
        }
      }

      const currentContent = readFileSync(absolutePath, 'utf8')

      // Check that oldString exists exactly once
      const occurrences = currentContent.split(oldString).length - 1
      if (occurrences === 0) {
        return {
          toolCallId,
          output: { error: `oldString not found in file: ${path}` },
          isError: true
        }
      }
      if (occurrences > 1) {
        return {
          toolCallId,
          output: { error: `oldString found ${occurrences} times in file: ${path}. Must be unique.` },
          isError: true
        }
      }

      // Apply the replacement
      const newContent = currentContent.replace(oldString, newString)
      writeFileSync(absolutePath, newContent, 'utf8')

      return {
        toolCallId,
        output: { 
          success: true, 
          path, 
          action: 'edited'
        },
        isError: false
      }
    } catch (error) {
      return {
        toolCallId,
        output: { error: error instanceof Error ? error.message : String(error) },
        isError: true
      }
    }
  }
}
