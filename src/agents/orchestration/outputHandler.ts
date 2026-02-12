import type { ToolCallRequest, ToolExecutor, ToolRegistry, ToolResult } from '../../core/ports/tool.js'
import type { ArtifactStore } from '../../core/ports/artifactStore.js'
import type { UiBus } from '../../core/ports/uiBus.js'
import type { TelemetrySink } from '../../core/ports/telemetry.js'
import type { DomainEvent } from '../../core/events/events.js'
import type { LLMMessage, LLMStreamChunk, LLMMessagePart } from '../../core/ports/llmClient.js'
import type { AgentOutput } from '../core/agent.js'
import type { ConversationManager } from './conversationManager.js'
import { buildConfirmInteraction } from '../display/displayBuilder.js'

// ============================================================================
// Output Handler
// ============================================================================

/**
 * Result returned after processing a single AgentOutput.
 *
 * - `event`    — domain event to persist (if any)
 * - `pause`    — true if execution should pause (awaiting user interaction)
 * - `terminal` — true if the task lifecycle ended (done / failed)
 */
export type OutputResult = {
  event?: DomainEvent
  pause?: boolean
  terminal?: boolean
}

/**
 * Mutable bag threaded through one agent-loop invocation.
 *
 * Keeps track of whether a risky-tool confirmation is still active so the
 * OutputHandler can clear it after use.
 */
export type OutputContext = {
  taskId: string
  agentId: string
  baseDir: string
  confirmedInteractionId?: string
  /**
   * The toolCallId that the confirmed interaction is bound to (SA-001).
   * When set, only the tool call with this exact ID may use the confirmation.
   */
  confirmedToolCallId?: string
  conversationHistory: readonly LLMMessage[]
  persistMessage: (m: LLMMessage) => Promise<void>
  /** AbortSignal propagated to tool execution for cooperative cancellation. */
  signal?: AbortSignal
  /** When true, text/reasoning are streamed via UiBus stream_delta events instead. */
  streamingEnabled?: boolean
}

/**
 * OutputHandler interprets each AgentOutput value yielded by an Agent
 * and converts it into side-effects (UI push, tool execution, domain events).
 *
 * Extracted from AgentRuntime so that:
 * - Runtime only orchestrates the event-loop and concurrency.
 * - Tool execution + result persistence lives in one focused place.
 * - Each output kind is easily testable in isolation.
 */
export class OutputHandler {
  readonly #toolExecutor: ToolExecutor
  readonly #toolRegistry: ToolRegistry
  readonly #artifactStore: ArtifactStore
  readonly #uiBus: UiBus | null
  readonly #conversationManager: ConversationManager
  readonly #telemetry: TelemetrySink

  constructor(opts: {
    toolExecutor: ToolExecutor
    toolRegistry: ToolRegistry
    artifactStore: ArtifactStore
    uiBus?: UiBus | null
    conversationManager: ConversationManager
    telemetry?: TelemetrySink
  }) {
    this.#toolExecutor = opts.toolExecutor
    this.#toolRegistry = opts.toolRegistry
    this.#artifactStore = opts.artifactStore
    this.#uiBus = opts.uiBus ?? null
    this.#conversationManager = opts.conversationManager
    this.#telemetry = opts.telemetry ?? { emit: () => {} }
  }

  /**
   * Process a single AgentOutput and return any resulting domain event.
   */
  async handle(output: AgentOutput, ctx: OutputContext): Promise<OutputResult> {
    switch (output.kind) {
      case 'text':
        if (!ctx.streamingEnabled) this.#emitUi(ctx, 'text', output.content)
        return {}

      case 'verbose':
        this.#emitUi(ctx, 'verbose', output.content)
        return {}

      case 'error':
        this.#emitUi(ctx, 'error', output.content)
        return {}

      case 'reasoning':
        if (!ctx.streamingEnabled) this.#emitUi(ctx, 'reasoning', output.content)
        return {}

      case 'tool_call':
        return this.#handleSingleToolCall(output.call, ctx)

      case 'tool_calls':
        return this.handleToolCalls(output.calls, ctx)

      case 'interaction': {
        const event: DomainEvent = {
          type: 'UserInteractionRequested',
          payload: {
            taskId: ctx.taskId,
            interactionId: output.request.interactionId,
            kind: output.request.kind,
            purpose: output.request.purpose,
            display: output.request.display,
            options: output.request.options,
            validation: output.request.validation,
            authorActorId: ctx.agentId
          }
        }
        return { event, pause: true }
      }

      case 'done': {
        const event: DomainEvent = {
          type: 'TaskCompleted',
          payload: {
            taskId: ctx.taskId,
            summary: output.summary,
            authorActorId: ctx.agentId
          }
        }
        return { event, terminal: true }
      }

      case 'failed': {
        const event: DomainEvent = {
          type: 'TaskFailed',
          payload: {
            taskId: ctx.taskId,
            reason: output.reason,
            authorActorId: ctx.agentId
          }
        }
        return { event, terminal: true }
      }

      default: {
        const _exhaustive: never = output
        return _exhaustive
      }
    }
  }

  // ---------- batch tool execution ----------

  /**
   * Handle a batch of tool calls with concurrent execution for safe tools.
   *
   * Strategy:
   * 1. Partition tool calls into safe (concurrent) and risky (sequential)
   * 2. Execute all safe tools concurrently via Promise.allSettled
   * 3. Process risky tools sequentially with UIP confirmation
   *
   * This provides significant performance improvement when agents request
   * multiple independent read-only operations (readFile, glob, grep, etc.)
   */
  async handleToolCalls(calls: ToolCallRequest[], ctx: OutputContext): Promise<OutputResult> {
    if (calls.length === 0) return {}

    if (calls.length === 1) {
      return this.#handleSingleToolCall(calls[0]!, ctx)
    }

    const { safeCalls, riskyCalls } = this.#partitionByRisk(calls)

    // Emit batch start event for UI feedback
    this.#uiBus?.emit({
      type: 'tool_calls_batch_start',
      payload: {
        taskId: ctx.taskId,
        agentId: ctx.agentId,
        count: calls.length,
        safeCount: safeCalls.length,
        riskyCount: riskyCalls.length,
      }
    })

    // Execute safe tools concurrently
    if (safeCalls.length > 0) {
      await this.#executeConcurrent(safeCalls, ctx)
    }

    // Process risky tools sequentially with UIP confirmation
    for (const call of riskyCalls) {
      const result = await this.#handleSingleToolCall(call, ctx)
      if (result.pause || result.event) {
        this.#uiBus?.emit({
          type: 'tool_calls_batch_end',
          payload: { taskId: ctx.taskId, agentId: ctx.agentId }
        })
        return result
      }
    }

    this.#uiBus?.emit({
      type: 'tool_calls_batch_end',
      payload: { taskId: ctx.taskId, agentId: ctx.agentId }
    })

    return {}
  }

  /**
   * Partition tool calls by risk level.
   */
  #partitionByRisk(calls: ToolCallRequest[]): { safeCalls: ToolCallRequest[]; riskyCalls: ToolCallRequest[] } {
    const safeCalls: ToolCallRequest[] = []
    const riskyCalls: ToolCallRequest[] = []

    for (const call of calls) {
      const tool = this.#toolRegistry.get(call.toolName)
      if (tool?.riskLevel === 'risky') {
        riskyCalls.push(call)
      } else {
        safeCalls.push(call)
      }
    }

    return { safeCalls, riskyCalls }
  }

  /**
   * Execute multiple safe tool calls concurrently.
   * Uses Promise.allSettled so one failure doesn't block others.
   */
  async #executeConcurrent(calls: ToolCallRequest[], ctx: OutputContext): Promise<void> {
    const results = await Promise.allSettled(
      calls.map(call => this.#executeToolWithoutRiskCheck(call, ctx))
    )

    // Log any rejections (shouldn't happen for safe tools, but handle gracefully)
    for (let index = 0; index < results.length; index++) {
      const result = results[index]
      if (result.status === 'rejected') {
        const call = calls[index]!
        console.error(
          `[OutputHandler] Tool ${call.toolName} (${call.toolCallId}) rejected:`,
          result.reason
        )
      }
    }
  }

  /**
   * Execute a single safe tool call without risk checks.
   * Used by #executeConcurrent for parallel execution.
   */
  async #executeToolWithoutRiskCheck(call: ToolCallRequest, ctx: OutputContext): Promise<void> {
    const tool = this.#toolRegistry.get(call.toolName)

    const toolContext = {
      taskId: ctx.taskId,
      actorId: ctx.agentId,
      baseDir: ctx.baseDir,
      confirmedInteractionId: ctx.confirmedInteractionId,
      artifactStore: this.#artifactStore,
      signal: ctx.signal
    }

    // Pre-execution check (canExecute)
    if (tool?.canExecute) {
      try {
        await tool.canExecute(call.arguments, toolContext)
      } catch (error) {
        const errMessage = error instanceof Error ? error.message : String(error)
        await this.#conversationManager.persistToolResultIfMissing(
          ctx.taskId,
          call.toolCallId,
          call.toolName,
          { error: errMessage },
          true,
          ctx.conversationHistory,
          ctx.persistMessage
        )
        return
      }
    }

    // Emit tool_call_start UiEvent
    this.#uiBus?.emit({
      type: 'tool_call_start',
      payload: {
        taskId: ctx.taskId,
        agentId: ctx.agentId,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        arguments: call.arguments,
      }
    })

    const startMs = Date.now()
    const result: ToolResult = await this.#toolExecutor.execute(call, toolContext)
    const durationMs = Date.now() - startMs

    // Emit tool_call_end UiEvent
    this.#uiBus?.emit({
      type: 'tool_call_end',
      payload: {
        taskId: ctx.taskId,
        agentId: ctx.agentId,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: result.output,
        isError: result.isError,
        durationMs,
      }
    })

    // Persist into conversation
    await this.#conversationManager.persistToolResultIfMissing(
      ctx.taskId,
      call.toolCallId,
      call.toolName,
      result.output,
      result.isError,
      ctx.conversationHistory,
      ctx.persistMessage
    )
  }

  /**
   * Handle a single tool call with full risk assessment and UIP confirmation.
   * This is the original tool_call handling logic, extracted for reuse.
   */
  async #handleSingleToolCall(call: ToolCallRequest, ctx: OutputContext): Promise<OutputResult> {
    const tool = this.#toolRegistry.get(call.toolName)

    const toolContext = {
      taskId: ctx.taskId,
      actorId: ctx.agentId,
      baseDir: ctx.baseDir,
      confirmedInteractionId: ctx.confirmedInteractionId,
      artifactStore: this.#artifactStore,
      signal: ctx.signal
    }

    // Universal Pre-Execution Check
    // If the tool implements canExecute, run it first.
    // If it fails, we skip risk checks and execution, returning the error immediately.
    if (tool?.canExecute) {
      try {
        await tool.canExecute(call.arguments, toolContext)
      } catch (error) {
        const errMessage = error instanceof Error ? error.message : String(error)

        await this.#conversationManager.persistToolResultIfMissing(
          ctx.taskId,
          call.toolCallId,
          call.toolName,
          { error: errMessage },
          true,
          ctx.conversationHistory,
          ctx.persistMessage
        )
        return {}
      }
    }

    const isRisky = tool?.riskLevel === 'risky'

    // Risky tool: needs confirmation. Either unconfirmed, or confirmed
    // for a different tool call (SA-001 — approval must be action-bound).
    const needsConfirmation = isRisky && (
      !ctx.confirmedInteractionId ||
      (ctx.confirmedToolCallId && ctx.confirmedToolCallId !== call.toolCallId)
    )

    if (needsConfirmation) {
      const confirmReq = buildConfirmInteraction(call)
      const event: DomainEvent = {
        type: 'UserInteractionRequested',
        payload: {
          taskId: ctx.taskId,
          interactionId: confirmReq.interactionId,
          kind: confirmReq.kind,
          purpose: confirmReq.purpose,
          display: confirmReq.display,
          options: confirmReq.options,
          validation: confirmReq.validation,
          authorActorId: ctx.agentId
        }
      }
      return { event, pause: true }
    }

    // Emit tool_call_start UiEvent so the frontend can show real-time tool activity
    this.#uiBus?.emit({
      type: 'tool_call_start',
      payload: {
        taskId: ctx.taskId,
        agentId: ctx.agentId,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        arguments: call.arguments,
      }
    })

    const startMs = Date.now()
    const result: ToolResult = await this.#toolExecutor.execute(call, toolContext)
    const durationMs = Date.now() - startMs

    // Emit tool_call_end UiEvent with result
    this.#uiBus?.emit({
      type: 'tool_call_end',
      payload: {
        taskId: ctx.taskId,
        agentId: ctx.agentId,
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        output: result.output,
        isError: result.isError,
        durationMs,
      }
    })

    // Persist into conversation (idempotent)
    await this.#conversationManager.persistToolResultIfMissing(
      ctx.taskId,
      call.toolCallId,
      call.toolName,
      result.output,
      result.isError,
      ctx.conversationHistory,
      ctx.persistMessage
    )

    if (isRisky) {
      // Clear the one-time confirmation after use
      ctx.confirmedInteractionId = undefined
      ctx.confirmedToolCallId = undefined
    }

    return {}
  }

  // ---------- rejection handling ----------

  /**
   * Record rejection results for dangling risky tool calls.
   *
   * Called before agent.run() when the user rejected a risky tool confirmation.
   * Only the tool call bound to the rejected interaction should be rejected.
   */
  async handleRejections(ctx: OutputContext, targetToolCallId?: string): Promise<void> {
    if (!targetToolCallId) return

    const pendingCalls = this.#conversationManager.getPendingToolCalls(ctx.conversationHistory)
    const rejectedCalls = pendingCalls.filter((call) => call.toolCallId === targetToolCallId)
    if (rejectedCalls.length === 0) return

    const toolContext = {
      taskId: ctx.taskId,
      actorId: ctx.agentId,
      baseDir: ctx.baseDir,
      artifactStore: this.#artifactStore
    }

    for (const call of rejectedCalls) {
      const tool = this.#toolRegistry.get(call.toolName)
      if (tool?.riskLevel !== 'risky') continue

      const result = this.#toolExecutor.recordRejection(call, toolContext)
      await this.#conversationManager.persistToolResultIfMissing(
        ctx.taskId,
        call.toolCallId,
        call.toolName,
        result.output,
        result.isError,
        ctx.conversationHistory,
        ctx.persistMessage
      )
    }
  }

  // ---------- streaming ----------

  /**
   * Create a callback for `LLMClient.stream()` that forwards text/reasoning
   * deltas to the UiBus as `stream_delta` events, while accumulating an ordered
   * `parts` array that captures the true interleaved output sequence.
   * Emits `stream_end` on the `done` chunk.
   *
   * Returns both the callback and a `getParts()` accessor for the accumulated parts array.
   */
  createStreamChunkHandler(ctx: OutputContext): {
    onChunk: (chunk: LLMStreamChunk) => void
    getParts: () => LLMMessagePart[]
  } {
    const parts: LLMMessagePart[] = []
    let currentKind: 'text' | 'reasoning' | null = null

    const onChunk = (chunk: LLMStreamChunk) => {
      if (chunk.type === 'text') {
        this.#uiBus?.emit({
          type: 'stream_delta',
          payload: { taskId: ctx.taskId, agentId: ctx.agentId, kind: 'text', content: chunk.content }
        })
        // Accumulate into ordered parts array — merge consecutive same-kind
        if (currentKind === 'text' && parts.length > 0) {
          const last = parts[parts.length - 1]!
          if (last.kind === 'text') {
            last.content += chunk.content
          }
        } else {
          parts.push({ kind: 'text', content: chunk.content })
          currentKind = 'text'
        }
      } else if (chunk.type === 'reasoning') {
        this.#uiBus?.emit({
          type: 'stream_delta',
          payload: { taskId: ctx.taskId, agentId: ctx.agentId, kind: 'reasoning', content: chunk.content }
        })
        if (currentKind === 'reasoning' && parts.length > 0) {
          const last = parts[parts.length - 1]!
          if (last.kind === 'reasoning') {
            last.content += chunk.content
          }
        } else {
          parts.push({ kind: 'reasoning', content: chunk.content })
          currentKind = 'reasoning'
        }
      } else if (chunk.type === 'tool_call_start') {
        parts.push({
          kind: 'tool_call',
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          arguments: {},
        })
        currentKind = null
      } else if (chunk.type === 'done') {
        this.#uiBus?.emit({
          type: 'stream_end',
          payload: { taskId: ctx.taskId, agentId: ctx.agentId }
        })
      }
      // tool_call_delta/end: arguments are accumulated by the LLM client,
      // the complete arguments will be available in LLMResponse.toolCalls
    }

    return { onChunk, getParts: () => parts }
  }

  // ---------- internals ----------

  #emitUi(ctx: OutputContext, kind: 'text' | 'verbose' | 'error' | 'reasoning', content: string): void {
    this.#uiBus?.emit({
      type: 'agent_output',
      payload: { taskId: ctx.taskId, agentId: ctx.agentId, kind, content }
    })
  }
}
