/**
 * Built-in Tool: grepTool
 *
 * Searches for text in files using regex.
 * Risk level: safe
 */

import { nanoid } from 'nanoid'
import type { Tool, ToolContext, ToolResult } from '../../core/ports/tool.js'
import { execFile, type ExecFileException } from 'node:child_process'

function execFilePromise(
  file: string,
  args: string[],
  options: { cwd: string; encoding: 'utf8' }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(error)
      } else {
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '' })
      }
    })
  })
}

/** Validate a search pattern does not contain null bytes. */
function validatePattern(pattern: string): void {
  if (pattern.includes('\0')) {
    throw new Error('Pattern must not contain null bytes')
  }
}

export const grepTool: Tool = {
  name: 'grepTool',
  description: 'Search for patterns in files. Uses git-grep or grep if available, falling back to JS implementation.',
  parameters: {
    type: 'object',
    properties: {
      pattern: {
        type: 'string',
        description: 'The regular expression pattern to search for'
      },
      path: {
        type: 'string',
        description: 'Optional: Directory to search in (default: root)'
      },
      include: {
        type: 'string',
        description: 'Optional: Glob pattern for files to include (e.g. "**/*.ts")'
      }
    },
    required: ['pattern']
  },
  riskLevel: 'safe',
  group: 'search',

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const toolCallId = `tool_${nanoid(12)}`
    const pattern = args.pattern as string
    const dirPath = (args.path as string) ?? '.'
    const include = args.include as string | undefined

    try {
      validatePattern(pattern)

      // Strategy 1: git grep (using execFile with argument arrays — no shell injection)
      try {
        // Check if git repo
        await execFilePromise('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ctx.baseDir, encoding: 'utf8' })
        
        // Build git grep command with safe argument array
        const gitArgs = ['grep', '-I', '-n', '-E', pattern, dirPath]
        if (include) gitArgs.push('--', include)
        
        const { stdout } = await execFilePromise('git', gitArgs, { cwd: ctx.baseDir, encoding: 'utf8' })
        return successResult(toolCallId, stdout, 'git grep')
      } catch (e) {
        // git grep failed or not a repo, fall through
      }

      // Strategy 2: system grep (using execFile with argument arrays — no shell injection)
      try {
        const grepArgs = ['-r', '-I', '-n', '-E', pattern]
        if (include) grepArgs.push(`--include=${include}`)
        grepArgs.push(dirPath)
        
        const { stdout } = await execFilePromise('grep', grepArgs, { cwd: ctx.baseDir, encoding: 'utf8' })
        return successResult(toolCallId, stdout, 'system grep')
      } catch (e) {
        // grep failed, fall through
      }

      // Strategy 3: JS fallback
      const searchPattern = include ?? (dirPath === '.' ? '**/*' : `${dirPath}/**/*`)
      const files = await ctx.artifactStore.glob(searchPattern)
      
      const regex = new RegExp(pattern, 'm') // Multiline? Or per line? Grep usually reports line numbers.
      // We need to read file line by line or split.
      
      const results: string[] = []
      
      for (const file of files) {
        try {
          const content = await ctx.artifactStore.readFile(file)
          const lines = content.split('\n')
          lines.forEach((line, index) => {
            if (regex.test(line)) {
              results.push(`${file}:${index + 1}:${line}`)
            }
          })
        } catch {
          // Ignore read errors
        }
      }

      return successResult(toolCallId, results.join('\n'), 'js fallback')

    } catch (error) {
      return {
        toolCallId,
        output: { error: error instanceof Error ? error.message : String(error) },
        isError: true
      }
    }
  }
}

function successResult(toolCallId: string, content: string, strategy: string): ToolResult {
  const lines = content.trim().split('\n')
  const count = content.trim() ? lines.length : 0
  
  return {
    toolCallId,
    output: {
      content: content.trim() || 'No matches found.',
      count,
      strategy
    },
    isError: false
  }
}
