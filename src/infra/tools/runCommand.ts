/**
 * Built-in Tool: runCommand
 *
 * Executes a shell command in the workspace.
 * Risk level: risky (requires UIP confirmation)
 */

import { execSync } from 'node:child_process'
import { nanoid } from 'nanoid'
import type { Tool, ToolContext, ToolResult } from '../../domain/ports/tool.js'

const MAX_OUTPUT_LENGTH = 10000

export const runCommandTool: Tool = {
  name: 'runCommand',
  description: 'Execute a shell command in the workspace directory. Returns stdout and stderr. Use with caution.',
  parameters: {
    type: 'object',
    properties: {
      command: {
        type: 'string',
        description: 'The shell command to execute'
      },
      timeout: {
        type: 'number',
        description: 'Optional: Timeout in milliseconds (default: 30000)'
      }
    },
    required: ['command']
  },
  riskLevel: 'risky',

  async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const toolCallId = `tool_${nanoid(12)}`
    const command = args.command as string
    const timeout = (args.timeout as number) ?? 30000

    try {
      const output = execSync(command, {
        cwd: ctx.baseDir,
        timeout,
        encoding: 'utf8',
        maxBuffer: 1024 * 1024, // 1MB
        stdio: ['pipe', 'pipe', 'pipe']
      })

      const truncatedOutput = output.length > MAX_OUTPUT_LENGTH 
        ? output.slice(0, MAX_OUTPUT_LENGTH) + '\n... (output truncated)'
        : output

      return {
        toolCallId,
        output: { 
          stdout: truncatedOutput, 
          exitCode: 0,
          command 
        },
        isError: false
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'stdout' in error && 'stderr' in error) {
        const execError = error as { stdout: string; stderr: string; status: number }
        const stderr = execError.stderr?.slice(0, MAX_OUTPUT_LENGTH) ?? ''
        const stdout = execError.stdout?.slice(0, MAX_OUTPUT_LENGTH) ?? ''
        return {
          toolCallId,
          output: { 
            stdout,
            stderr,
            exitCode: execError.status ?? 1,
            command 
          },
          isError: true
        }
      }
      return {
        toolCallId,
        output: { error: error instanceof Error ? error.message : String(error), command },
        isError: true
      }
    }
  }
}
