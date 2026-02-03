/**
 * Infrastructure Layer - Tool Executor Implementation
 *
 * Executes tools with audit logging.
 */

import type { AuditLog } from '../domain/ports/auditLog.js'
import type {
  ToolCallRequest,
  ToolContext,
  ToolExecutor,
  ToolRegistry,
  ToolResult
} from '../domain/ports/tool.js'

export class DefaultToolExecutor implements ToolExecutor {
  readonly #registry: ToolRegistry
  readonly #auditLog: AuditLog

  constructor(opts: { registry: ToolRegistry; auditLog: AuditLog }) {
    this.#registry = opts.registry
    this.#auditLog = opts.auditLog
  }

  async execute(call: ToolCallRequest, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.#registry.get(call.toolName)
    if (!tool) {
      return {
        toolCallId: call.toolCallId,
        output: { error: `Unknown tool: ${call.toolName}` },
        isError: true
      }
    }

    // Risk check: risky tools require explicit UIP confirmation
    if (tool.riskLevel === 'risky' && !ctx.confirmedInteractionId) {
      return {
        toolCallId: call.toolCallId,
        output: {
          error: `Tool '${call.toolName}' is risky and requires user confirmation via UIP before execution. ` +
            `Agent must first emit UserInteractionRequested(purpose='confirm_risky_action') and receive confirmation.`
        },
        isError: true
      }
    }

    const startTime = Date.now()

    // Log the request
    this.#auditLog.append({
      type: 'ToolCallRequested',
      payload: {
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        authorActorId: ctx.actorId,
        taskId: ctx.taskId,
        input: call.arguments as Record<string, unknown>,
        timestamp: startTime
      }
    })

    // Execute the tool
    let result: ToolResult
    try {
      result = await tool.execute(call.arguments as Record<string, unknown>, ctx)
      // Ensure the toolCallId matches
      result = { ...result, toolCallId: call.toolCallId }
    } catch (error) {
      result = {
        toolCallId: call.toolCallId,
        output: { error: error instanceof Error ? error.message : String(error) },
        isError: true
      }
    }

    const endTime = Date.now()

    // Log the completion
    this.#auditLog.append({
      type: 'ToolCallCompleted',
      payload: {
        toolCallId: call.toolCallId,
        authorActorId: ctx.actorId,
        taskId: ctx.taskId,
        output: result.output,
        isError: result.isError,
        durationMs: endTime - startTime,
        timestamp: endTime
      }
    })

    return result
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createToolExecutor(opts: {
  registry: ToolRegistry
  auditLog: AuditLog
}): ToolExecutor {
  return new DefaultToolExecutor(opts)
}
