/**
 * Infrastructure Layer - Tool Executor Implementation
 *
 * Executes tools with audit logging.
 * All audit log calls are properly awaited to prevent unhandled rejections.
 * Tool arguments are validated against the tool's parameter schema before execution.
 */

import type { AuditLog } from '../../core/ports/auditLog.js'
import type {
  ToolRiskLevel,
  ToolCallRequest,
  ToolContext,
  ToolExecutor,
  ToolRegistry,
  ToolResult
} from '../../core/ports/tool.js'
import { evaluateToolRiskLevel } from '../../core/ports/tool.js'
import { validateToolArgs } from './toolSchemaValidator.js'

export class DefaultToolExecutor implements ToolExecutor {
  readonly #registry: ToolRegistry
  readonly #auditLog: AuditLog

  constructor(opts: { registry: ToolRegistry; auditLog: AuditLog }) {
    this.#registry = opts.registry
    this.#auditLog = opts.auditLog
  }

  recordRejection(call: ToolCallRequest, ctx: ToolContext): ToolResult {
    const now = Date.now()

    // Fire-and-forget is acceptable for synchronous rejection path,
    // but we still guard against unhandled rejections
    this.#auditLog.append({
      type: 'ToolCallRequested',
      payload: {
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        authorActorId: ctx.actorId || 'unknown',
        taskId: ctx.taskId,
        input: call.arguments as Record<string, unknown>,
        timestamp: now
      }
    }).catch(err => { console.error('[ToolExecutor] audit log error:', err) })

    const result: ToolResult = {
      toolCallId: call.toolCallId,
      output: { isError: true, error: 'User rejected the request' },
      isError: true
    }

    this.#auditLog.append({
      type: 'ToolCallCompleted',
      payload: {
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        authorActorId: ctx.actorId || 'unknown',
        taskId: ctx.taskId,
        output: result.output,
        isError: true,
        durationMs: 0,
        timestamp: now
      }
    }).catch(err => { console.error('[ToolExecutor] audit log error:', err) })

    return result
  }

  async execute(call: ToolCallRequest, ctx: ToolContext): Promise<ToolResult> {
    // Validate actorId — every tool execution must have an actor
    if (!ctx.actorId) {
      return {
        toolCallId: call.toolCallId,
        output: { error: 'actorId is required for tool execution' },
        isError: true
      }
    }

    const startTime = Date.now()

    // Always log tool calls, even if we fail before execution.
    try {
      await this.#auditLog.append({
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
    } catch (err) {
      console.error('[ToolExecutor] failed to log ToolCallRequested:', err)
    }

    const finalize = async (result: ToolResult): Promise<ToolResult> => {
      const endTime = Date.now()
      try {
        await this.#auditLog.append({
          type: 'ToolCallCompleted',
          payload: {
            toolCallId: call.toolCallId,
            toolName: call.toolName,
            authorActorId: ctx.actorId,
            taskId: ctx.taskId,
            output: result.output,
            isError: result.isError,
            durationMs: endTime - startTime,
            timestamp: endTime
          }
        })
      } catch (err) {
        console.error('[ToolExecutor] failed to log ToolCallCompleted:', err)
      }
      return result
    }

    // Early abort check: if signal is already aborted, skip execution (PR-003)
    if (ctx.signal?.aborted) {
      return await finalize({
        toolCallId: call.toolCallId,
        output: { error: 'Tool execution aborted: task was canceled or paused' },
        isError: true
      })
    }

    const tool = this.#registry.get(call.toolName)
    if (!tool) {
      return await finalize({
        toolCallId: call.toolCallId,
        output: { error: `Unknown tool: ${call.toolName}` },
        isError: true
      })
    }

    // Validate tool arguments against the tool's parameter schema (B5)
    const validationError = validateToolArgs(call.arguments as Record<string, unknown>, tool.parameters)
    if (validationError) {
      return await finalize({
        toolCallId: call.toolCallId,
        output: { error: `Invalid tool arguments: ${validationError}` },
        isError: true
      })
    }

    const riskLevel: ToolRiskLevel = evaluateToolRiskLevel(tool, call.arguments as Record<string, unknown>, ctx)

    // Risk check: risky tools require explicit UIP confirmation
    if (riskLevel === 'risky' && !ctx.confirmedInteractionId) {
      return await finalize({
        toolCallId: call.toolCallId,
        output: {
          error: `Tool '${call.toolName}' is risky and requires user confirmation via UIP before execution. ` +
            `Agent must first emit UserInteractionRequested(purpose='confirm_risky_action') and receive confirmation.`
        },
        isError: true
      })
    }

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

    return await finalize(result)
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
