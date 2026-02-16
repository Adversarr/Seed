import type {
  ToolCallRequest,
  ToolContext,
  ToolExecutor,
  ToolRegistry,
  ToolResult,
  WorkspacePathResolver
} from '../../core/ports/tool.js'
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
  readonly #workspaceResolver: WorkspacePathResolver | undefined
  readonly #uiBus: UiBus | null
  readonly #conversationManager: ConversationManager
  readonly #telemetry: TelemetrySink
  readonly #toolHeartbeatMs: number

  constructor(opts: {
    toolExecutor: ToolExecutor
    toolRegistry: ToolRegistry
    artifactStore: ArtifactStore
    workspaceResolver?: WorkspacePathResolver
    uiBus?: UiBus | null
    conversationManager: ConversationManager
    telemetry?: TelemetrySink
    toolHeartbeatMs?: number
  }) {
    this.#toolExecutor = opts.toolExecutor
    this.#toolRegistry = opts.toolRegistry
    this.#artifactStore = opts.artifactStore
    this.#workspaceResolver = opts.workspaceResolver
    this.#uiBus = opts.uiBus ?? null
    this.#conversationManager = opts.conversationManager
    this.#telemetry = opts.telemetry ?? { emit: () => {} }
    this.#toolHeartbeatMs = opts.toolHeartbeatMs ?? 4_000
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
   * Handle a batch of tool calls with an order-preserving hybrid strategy:
   * - contiguous safe segments execute concurrently
   * - risky calls execute sequentially and require UIP confirmation
   *
   * Risky calls are ordering barriers. This preserves model intent while still
   * unlocking concurrency for independent safe calls.
   */
  async handleToolCalls(calls: ToolCallRequest[], ctx: OutputContext): Promise<OutputResult> {
    if (calls.length === 0) return {}

    if (calls.length === 1) {
      return this.#handleSingleToolCall(calls[0]!, ctx)
    }

    const { safeCount, riskyCount } = this.#countByRisk(calls)

    // Emit batch start event for UI feedback
    this.#uiBus?.emit({
      type: 'tool_calls_batch_start',
      payload: {
        taskId: ctx.taskId,
        agentId: ctx.agentId,
        count: calls.length,
        safeCount,
        riskyCount,
      }
    })

    try {
      // Execute in original order. Risky calls are barriers.
      for (let index = 0; index < calls.length;) {
        const call = calls[index]!
        if (this.#isRiskyCall(call)) {
          const result = await this.#handleSingleToolCall(call, ctx)
          if (result.pause || result.event || result.terminal) return result
          index += 1
          continue
        }

        // Run contiguous safe segment concurrently.
        const safeSegment: ToolCallRequest[] = []
        while (index < calls.length && !this.#isRiskyCall(calls[index]!)) {
          safeSegment.push(calls[index]!)
          index += 1
        }
        await this.#executeConcurrentSegment(safeSegment, ctx)
      }
      return {}
    } finally {
      this.#uiBus?.emit({
        type: 'tool_calls_batch_end',
        payload: { taskId: ctx.taskId, agentId: ctx.agentId }
      })
    }
  }

  async #executeSafeToolCall(call: ToolCallRequest, ctx: OutputContext): Promise<void> {
    const tool = this.#toolRegistry.get(call.toolName)

    const toolContext: ToolContext = {
      taskId: ctx.taskId,
      actorId: ctx.agentId,
      baseDir: ctx.baseDir,
      confirmedInteractionId: ctx.confirmedInteractionId,
      artifactStore: this.#artifactStore,
      workspaceResolver: this.#workspaceResolver,
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

    await this.#executeToolCall(call, toolContext, ctx)
  }

  /**
   * Execute a contiguous safe segment concurrently and fail fast if any item
   * rejects before it can persist a deterministic tool result.
   */
  async #executeConcurrentSegment(calls: ToolCallRequest[], ctx: OutputContext): Promise<void> {
    if (calls.length === 0) return

    const settled = await Promise.allSettled(
      calls.map(call => this.#executeSafeToolCall(call, ctx))
    )

    const rejected = settled
      .map((result, index) => ({ result, call: calls[index]! }))
      .filter(
        (entry): entry is { result: PromiseRejectedResult; call: ToolCallRequest } =>
          entry.result.status === 'rejected'
      )

    if (rejected.length === 0) return

    const details = rejected
      .map(({ call, result }) => `${call.toolName}(${call.toolCallId}): ${String(result.reason)}`)
      .join('; ')
    throw new Error(`Concurrent tool segment failed for ${rejected.length} call(s): ${details}`)
  }

  #isRiskyCall(call: ToolCallRequest): boolean {
    return this.#toolRegistry.get(call.toolName)?.riskLevel === 'risky'
  }

  #countByRisk(calls: ToolCallRequest[]): { safeCount: number; riskyCount: number } {
    let safeCount = 0
    let riskyCount = 0
    for (const call of calls) {
      if (this.#isRiskyCall(call)) riskyCount += 1
      else safeCount += 1
    }
    return { safeCount, riskyCount }
  }

  async #executeToolCall(
    call: ToolCallRequest,
    toolContext: ToolContext,
    ctx: OutputContext
  ): Promise<void> {
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

    let result: ToolResult
    try {
      result = await this.#runWithToolHeartbeat(call, ctx, startMs, () =>
        this.#toolExecutor.execute(call, toolContext)
      )
    } catch (error) {
      result = {
        toolCallId: call.toolCallId,
        output: { error: error instanceof Error ? error.message : String(error) },
        isError: true,
      }
    }

    const durationMs = Date.now() - startMs

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

  async #runWithToolHeartbeat<T>(
    call: ToolCallRequest,
    ctx: OutputContext,
    startMs: number,
    work: () => Promise<T>
  ): Promise<T> {
    if (this.#toolHeartbeatMs <= 0 || !this.#uiBus) return work()

    const heartbeat = setInterval(() => {
      this.#uiBus?.emit({
        type: 'tool_call_heartbeat',
        payload: {
          taskId: ctx.taskId,
          agentId: ctx.agentId,
          toolCallId: call.toolCallId,
          toolName: call.toolName,
          elapsedMs: Date.now() - startMs,
        }
      })
    }, this.#toolHeartbeatMs)

    try {
      return await work()
    } finally {
      clearInterval(heartbeat)
    }
  }

  /**
   * Handle a single tool call with full risk assessment and UIP confirmation.
   * This is the original tool_call handling logic, extracted for reuse.
   */
  async #handleSingleToolCall(call: ToolCallRequest, ctx: OutputContext): Promise<OutputResult> {
    const tool = this.#toolRegistry.get(call.toolName)

    const toolContext: ToolContext = {
      taskId: ctx.taskId,
      actorId: ctx.agentId,
      baseDir: ctx.baseDir,
      confirmedInteractionId: ctx.confirmedInteractionId,
      artifactStore: this.#artifactStore,
      workspaceResolver: this.#workspaceResolver,
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

    await this.#executeToolCall(call, toolContext, ctx)

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

    const toolContext: ToolContext = {
      taskId: ctx.taskId,
      actorId: ctx.agentId,
      baseDir: ctx.baseDir,
      artifactStore: this.#artifactStore,
      workspaceResolver: this.#workspaceResolver
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
