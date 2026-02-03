import type { Subscription } from 'rxjs'
import type { EventStore } from '../domain/ports/eventStore.js'
import type { LLMClient, LLMMessage } from '../domain/ports/llmClient.js'
import type { ToolRegistry, ToolExecutor, ToolResult } from '../domain/ports/tool.js'
import type { ConversationStore } from '../domain/ports/conversationStore.js'
import type { DomainEvent, StoredEvent, UserInteractionRespondedPayload } from '../domain/events.js'
import type { TaskService, TaskView } from '../application/taskService.js'
import type { InteractionService } from '../application/interactionService.js'
import type { Agent, AgentContext, AgentOutput } from './agent.js'

// ============================================================================
// Agent Runtime
// ============================================================================

/**
 * AgentRuntime manages the execution of agents with UIP + Tool Use.
 *
 * It orchestrates the agent → tool → interaction → resume loop:
 * 1. Agent yields AgentOutput (text, tool_call, interaction, done, failed)
 * 2. Runtime interprets each output and takes action
 * 3. For tool_call: execute via ToolExecutor, inject result back
 * 4. For interaction: emit UIP event, wait for response
 * 5. For done/failed: emit TaskCompleted/TaskFailed event
 *
 * Conversation history is persisted via ConversationStore for state recovery
 * across UIP pauses, app restarts, and crashes.
 */
export class AgentRuntime {
  readonly #store: EventStore
  readonly #conversationStore: ConversationStore
  readonly #taskService: TaskService
  readonly #interactionService: InteractionService
  readonly #agent: Agent
  readonly #llm: LLMClient
  readonly #toolRegistry: ToolRegistry
  readonly #toolExecutor: ToolExecutor
  readonly #baseDir: string

  #isRunning = false
  #subscription: Subscription | null = null
  #inFlight = new Set<string>() // Track in-flight task operations

  constructor(opts: {
    store: EventStore
    conversationStore: ConversationStore
    taskService: TaskService
    interactionService: InteractionService
    agent: Agent
    llm: LLMClient
    toolRegistry: ToolRegistry
    toolExecutor: ToolExecutor
    baseDir: string
  }) {
    this.#store = opts.store
    this.#conversationStore = opts.conversationStore
    this.#taskService = opts.taskService
    this.#interactionService = opts.interactionService
    this.#agent = opts.agent
    this.#llm = opts.llm
    this.#toolRegistry = opts.toolRegistry
    this.#toolExecutor = opts.toolExecutor
    this.#baseDir = opts.baseDir
  }

  /** The agent ID this runtime is responsible for */
  get agentId(): string {
    return this.#agent.id
  }

  start(): void {
    if (this.#isRunning) return
    this.#isRunning = true

    // Subscribe to event stream
    this.#subscription = this.#store.events$.subscribe({
      next: (event) => {
        void this.#handleEvent(event)
      }
    })
  }

  stop(): void {
    this.#isRunning = false
    if (this.#subscription) {
      this.#subscription.unsubscribe()
      this.#subscription = null
    }
  }

  get isRunning(): boolean {
    return this.#isRunning
  }

  async #handleEvent(event: StoredEvent): Promise<void> {
    if (!this.#isRunning) return

    // Handle TaskCreated events assigned to this agent
    if (event.type === 'TaskCreated' && event.payload.agentId === this.#agent.id) {
      const taskId = event.payload.taskId
      if (this.#inFlight.has(taskId)) return
      this.#inFlight.add(taskId)

      try {
        await this.executeTask(taskId)
      } catch (error) {
        console.error(`[AgentRuntime] Task handling failed for task ${taskId}:`, error)
      } finally {
        this.#inFlight.delete(taskId)
      }
    }

    // Handle UserInteractionResponded events for tasks assigned to this agent
    if (event.type === 'UserInteractionResponded') {
      const task = this.#taskService.getTask(event.payload.taskId)
      // Note: We don't check task.status === 'awaiting_user' because by the time
      // the projection runs, it has already processed this UserInteractionResponded
      // and set status to 'in_progress'. Instead, we rely on deduplication via
      // inFlight set to avoid processing the same response twice.
      if (task && task.agentId === this.#agent.id) {
        const taskId = task.taskId
        const resumeKey = `resume:${taskId}:${event.id}`
        if (this.#inFlight.has(resumeKey)) return
        this.#inFlight.add(resumeKey)

        try {
          await this.resumeTask(task.taskId, event.payload)
        } catch (error) {
          console.error(`[AgentRuntime] Resume failed for task ${task.taskId}:`, error)
        } finally {
          this.#inFlight.delete(resumeKey)
        }
      }
    }
  }

  /**
   * Execute an agent workflow for a task.
   *
   * This is the main entry point for task execution.
   * It can be called directly (for manual execution) or via subscription.
   */
  async executeTask(taskId: string): Promise<{ taskId: string; events: DomainEvent[] }> {
    const task = this.#taskService.getTask(taskId)
    if (!task) {
      throw new Error(`Task not found: ${taskId}`)
    }

    // Verify this task is assigned to our agent
    if (task.agentId !== this.#agent.id) {
      throw new Error(`Task ${taskId} assigned to ${task.agentId}, not ${this.#agent.id}`)
    }

    // Emit TaskStarted event
    const startedEvent: DomainEvent = {
      type: 'TaskStarted',
      payload: {
        taskId,
        agentId: this.#agent.id,
        authorActorId: this.#agent.id
      }
    }
    this.#store.append(taskId, [startedEvent])

    const emittedEvents: DomainEvent[] = [startedEvent]
    
    // Run the agent workflow
    const result = await this.#runAgentLoop(task, emittedEvents)
    return result
  }

  /**
   * Resume an agent workflow after user interaction response.
   */
  async resumeTask(
    taskId: string, 
    response: UserInteractionRespondedPayload
  ): Promise<{ taskId: string; events: DomainEvent[] }> {
    const task = this.#taskService.getTask(taskId)
    if (!task) {
      throw new Error(`Task not found: ${taskId}`)
    }

    // Verify this task is assigned to our agent
    if (task.agentId !== this.#agent.id) {
      throw new Error(`Task ${taskId} assigned to ${task.agentId}, not ${this.#agent.id}`)
    }

    const emittedEvents: DomainEvent[] = []
    
    // Run the agent workflow with the pending response
    const result = await this.#runAgentLoop(task, emittedEvents, response)
    return result
  }

  /**
   * Core agent execution loop.
   * 
   * Processes AgentOutput and takes appropriate action for each kind:
   * - text: Log/display (no event emitted)
   * - tool_call: Execute tool, inject result back
   * - interaction: Emit UIP event, pause execution
   * - done: Emit TaskCompleted
   * - failed: Emit TaskFailed
   *
   * Conversation history is loaded from ConversationStore at start and
   * persisted after each LLM response/tool result for crash recovery.
   */
  async #runAgentLoop(
    task: TaskView,
    emittedEvents: DomainEvent[],
    pendingResponse?: UserInteractionRespondedPayload
  ): Promise<{ taskId: string; events: DomainEvent[] }> {
    const taskId = task.taskId
    
    // Load persisted conversation history (enables resume across restarts)
    const conversationHistory: LLMMessage[] = this.#conversationStore.getMessages(taskId)
    const toolResults = new Map<string, ToolResult>()

    // If resuming from a confirm_risky_action response, track the confirmed interactionId
    // so we can pass it to ToolExecutor for risky tool execution
    const confirmedInteractionId = pendingResponse?.selectedOptionId === 'approve'
      ? pendingResponse.interactionId
      : undefined

    const context: AgentContext = {
      llm: this.#llm,
      tools: this.#toolRegistry,
      baseDir: this.#baseDir,
      conversationHistory,
      pendingInteractionResponse: pendingResponse,
      toolResults,
      confirmedInteractionId,
      // Provide callback for agent to persist messages
      persistMessage: (message: LLMMessage) => {
        this.#conversationStore.append(taskId, message)
        conversationHistory.push(message)
      }
    }

    try {
      for await (const output of this.#agent.run(task, context)) {
        const result = await this.#processOutput(taskId, output, context)
        
        if (result.event) {
          this.#store.append(taskId, [result.event])
          emittedEvents.push(result.event)
        }

        // If we need to pause (awaiting user interaction), exit the loop
        if (result.pause) {
          break
        }

        // If terminal, exit the loop
        if (result.terminal) {
          // Optionally clear conversation on completion (keep for audit trail)
          // this.#conversationStore.clear(taskId)
          break
        }
      }
    } catch (error) {
      const failureEvent: DomainEvent = {
        type: 'TaskFailed',
        payload: {
          taskId,
          reason: this.#formatError(error),
          authorActorId: this.#agent.id
        }
      }
      this.#store.append(taskId, [failureEvent])
      emittedEvents.push(failureEvent)
      throw error
    }

    return { taskId, events: emittedEvents }
  }

  /**
   * Process a single AgentOutput and return any resulting event.
   */
  async #processOutput(
    taskId: string,
    output: AgentOutput,
    context: AgentContext
  ): Promise<{ event?: DomainEvent; pause?: boolean; terminal?: boolean }> {
    switch (output.kind) {
      case 'text':
        // Text output - just log for now, no event
        console.log(`[Agent] ${output.content}`)
        return {}

      case 'tool_call': {
        const tool = this.#toolRegistry.get(output.call.toolName)
        const isRisky = tool?.riskLevel === 'risky'

        // Execute the tool with proper context
        const toolContext = {
          taskId,
          actorId: this.#agent.id,
          baseDir: this.#baseDir,
          confirmedInteractionId: context.confirmedInteractionId
        }
        const result = await this.#toolExecutor.execute(output.call, toolContext)
        // Inject result back into context for agent to use
        context.toolResults.set(output.call.toolCallId, result)
        if (isRisky) {
          context.confirmedInteractionId = undefined
        }
        // No domain event for tool calls (they go to AuditLog)
        return {}
      }

      case 'interaction': {
        // Request user interaction via UIP
        const event: DomainEvent = {
          type: 'UserInteractionRequested',
          payload: {
            taskId,
            interactionId: output.request.interactionId,
            kind: output.request.kind,
            purpose: output.request.purpose,
            display: output.request.display,
            options: output.request.options,
            validation: output.request.validation,
            authorActorId: this.#agent.id
          }
        }
        return { event, pause: true }
      }

      case 'done': {
        const event: DomainEvent = {
          type: 'TaskCompleted',
          payload: {
            taskId,
            summary: output.summary,
            authorActorId: this.#agent.id
          }
        }
        return { event, terminal: true }
      }

      case 'failed': {
        const event: DomainEvent = {
          type: 'TaskFailed',
          payload: {
            taskId,
            reason: output.reason,
            authorActorId: this.#agent.id
          }
        }
        return { event, terminal: true }
      }

      default: {
        // Type guard - should never reach here
        const _exhaustive: never = output
        return _exhaustive
      }
    }
  }

  #formatError(error: unknown): string {
    if (error instanceof Error) return error.message || String(error)
    return String(error)
  }
}
