/**
 * Built-in Tool: listFiles
 *
 * Lists files and directories in a given path.
 * Risk level: safe
 */

import { readdir, stat } from 'node:fs/promises'
import { resolve, join, relative } from 'node:path'
import { nanoid } from 'nanoid'
import type { Tool, ToolContext, ToolResult } from '../../domain/ports/tool.js'

export const listFilesTool: Tool = {
  name: 'listFiles',
  description: 'List files and directories in a given path. Returns names with / suffix for directories.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Relative path to the directory from workspace root. Use "." for root.'
      },
      recursive: {
        type: 'boolean',
        description: 'Optional: If true, list files recursively (default: false)'
      },
      maxDepth: {
        type: 'number',
        description: 'Optional: Maximum depth for recursive listing (default: 3)'
      }
    },
    required: ['path']
  },
  riskLevel: 'safe',

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const toolCallId = `tool_${nanoid(12)}`
    const path = args.path as string
    const recursive = (args.recursive as boolean) ?? false
    const maxDepth = (args.maxDepth as number) ?? 3

    try {
      const absolutePath = resolve(ctx.baseDir, path)
      const entries = await listDirectory(absolutePath, ctx.baseDir, recursive, maxDepth, 0)

      return {
        toolCallId,
        output: { path, entries, count: entries.length },
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

async function listDirectory(
  absolutePath: string,
  baseDir: string,
  recursive: boolean,
  maxDepth: number,
  currentDepth: number
): Promise<string[]> {
  const entries: string[] = []
  const items = await readdir(absolutePath)

  for (const item of items) {
    // Skip hidden files and common ignored directories
    if (item.startsWith('.') || item === 'node_modules' || item === '__pycache__') {
      continue
    }

    const itemPath = join(absolutePath, item)
    const relativePath = relative(baseDir, itemPath) + (itemPath.endsWith('/') ? '/' : '')

    try {
      const itemStat = await stat(itemPath)
      if (itemStat.isDirectory()) {
        entries.push(relativePath + '/')
        if (recursive && currentDepth < maxDepth) {
          entries.push(...await listDirectory(itemPath, baseDir, recursive, maxDepth, currentDepth + 1))
        }
      } else {
        entries.push(relativePath)
      }
    } catch {
      // Skip items we can't stat
    }
  }

  return entries
}
