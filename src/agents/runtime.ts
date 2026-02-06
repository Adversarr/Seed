import type { Subscription } from 'rxjs'
import type { EventStore } from '../domain/ports/eventStore.js'
import type { LLMClient, LLMMessage } from '../domain/ports/llmClient.js'
import type { ToolRegistry } from '../domain/ports/tool.js'
import type { DomainEvent, StoredEvent, UserInteractionRespondedPayload } from '../domain/events.js'
import type { TaskService, TaskView } from '../application/taskService.js'
import type { Agent, AgentContext, AgentOutput } from './agent.js'
import type { ConversationManager } from './conversationManager.js'
import type { OutputHandler, OutputContext } from './outputHandler.js'

// ============================================================================
// Agent Runtime
// ============================================================================

/**
 * AgentRuntime manages the execution of agents with UIP + Tool Use.
 *
 * Responsibilities (after decomposition):
 * - Event subscription and routing (TaskCreated, UIP responses, pause/resume, instructions)
 * - Concurrency control (in-flight deduplication, pause tracking)
 * - Task lifecycle (executeTask, resumeTask)
 * - Agent loop orchestration (delegates output handling to OutputHandler)
 *
 * Conversation management → ConversationManager
 * Output processing / tool execution → OutputHandler
 */
export class AgentRuntime {
  readonly #store: EventStore
  readonly #taskService: TaskService
  readonly #agent: Agent
  readonly #llm: LLMClient
  readonly #toolRegistry: ToolRegistry
  readonly #baseDir: string
  readonly #conversationManager: ConversationManager
  readonly #outputHandler: OutputHandler

  #isRunning = false
  #subscription: Subscription | null = null
  #inFlight = new Set<string>()
  #pausedTasks = new Set<string>()
  #queuedInstructionTasks = new Set<string>()
  #pendingInstructions = new Map<string, string[]>()

  constructor(opts: {
    store: EventStore
    taskService: TaskService
    agent: Agent
    llm: LLMClient
    toolRegistry: ToolRegistry
    baseDir: string
    conversationManager: ConversationManager
    outputHandler: OutputHandler
  }) {
    this.#store = opts.store
    this.#taskService = opts.taskService
    this.#agent = opts.agent
    this.#llm = opts.llm
    this.#toolRegistry = opts.toolRegistry
    this.#baseDir = opts.baseDir
    this.#conversationManager = opts.conversationManager
    this.#outputHandler = opts.outputHandler
  }

  /** The agent ID this runtime is responsible for */
  get agentId(): string {
    return this.#agent.id
  }

  // ======================== lifecycle ========================

  start(): void {
    if (this.#isRunning) return
    this.#isRunning = true

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

  // ======================== event routing ========================

  async #handleEvent(event: StoredEvent): Promise<void> {
    if (!this.#isRunning) return

    // --- TaskCreated ---
    if (event.type === 'TaskCreated' && event.payload.agentId === this.#agent.id) {
      const taskId = event.payload.taskId
      if (this.#inFlight.has(taskId)) return
      this.#inFlight.add(taskId)

      try {
        await this.#executeTaskAndDrainQueuedInstructions(taskId)
      } catch (error) {
        console.error(`[AgentRuntime] Task handling failed for task ${taskId}:`, error)
      } finally {
        this.#inFlight.delete(taskId)
      }
    }

    // --- UserInteractionResponded ---
    if (event.type === 'UserInteractionResponded') {
      const task = this.#taskService.getTask(event.payload.taskId)
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

    // --- TaskPaused ---
    if (event.type === 'TaskPaused') {
      const task = this.#taskService.getTask(event.payload.taskId)
      if (task && task.agentId === this.#agent.id) {
        this.#pausedTasks.add(task.taskId)
      }
    }

    // --- TaskResumed ---
    if (event.type === 'TaskResumed') {
      const task = this.#taskService.getTask(event.payload.taskId)
      if (task && task.agentId === this.#agent.id) {
        const taskId = task.taskId
        this.#pausedTasks.delete(taskId)

        if (this.#inFlight.has(taskId)) return
        this.#inFlight.add(taskId)

        try {
          await this.#executeTaskAndDrainQueuedInstructions(taskId)
        } catch (error) {
          console.error(`[AgentRuntime] Resume failed for task ${taskId}:`, error)
        } finally {
          this.#inFlight.delete(taskId)
        }
      }
    }

    // --- TaskInstructionAdded ---
    if (event.type === 'TaskInstructionAdded') {
      const task = this.#taskService.getTask(event.payload.taskId)
      if (task && task.agentId === this.#agent.id) {
        const taskId = task.taskId
        this.#pausedTasks.delete(taskId)

        const history = this.#conversationManager.store.getMessages(taskId)
        if (this.#conversationManager.isSafeToInject(history)) {
          this.#conversationManager.store.append(taskId, {
            role: 'user',
            content: event.payload.instruction
          } as LLMMessage)
        } else {
          const queue = this.#pendingInstructions.get(taskId) ?? []
          queue.push(event.payload.instruction)
          this.#pendingInstructions.set(taskId, queue)
        }

        if (task.status === 'awaiting_user') return

        if (this.#inFlight.has(taskId)) {
          this.#queuedInstructionTasks.add(taskId)
          return
        }
        this.#inFlight.add(taskId)

        try {
          await this.#executeTaskAndDrainQueuedInstructions(taskId)
        } catch (error) {
          console.error(`[AgentRuntime] Resume failed for task ${taskId}:`, error)
        } finally {
          this.#inFlight.delete(taskId)
        }
      }
    }
  }

  // ======================== task execution ========================

  async #executeTaskAndDrainQueuedInstructions(taskId: string): Promise<void> {
    while (true) {
      await this.executeTask(taskId)

      const task = this.#taskService.getTask(taskId)
      if (!task) return
      if (task.status === 'awaiting_user' || task.status === 'paused') return

      const hasQueuedTask = this.#queuedInstructionTasks.has(taskId)
      const hasPendingInstructions = (this.#pendingInstructions.get(taskId)?.length ?? 0) > 0

      if (!hasQueuedTask && !hasPendingInstructions) return

      this.#queuedInstructionTasks.delete(taskId)

      if (!this.#isRunning) return
      if (this.#pausedTasks.has(taskId)) return
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
    if (task.agentId !== this.#agent.id) {
      throw new Error(`Task ${taskId} assigned to ${task.agentId}, not ${this.#agent.id}`)
    }

    const startedEvent: DomainEvent = {
      type: 'TaskStarted',
      payload: { taskId, agentId: this.#agent.id, authorActorId: this.#agent.id }
    }
    this.#store.append(taskId, [startedEvent])

    const emittedEvents: DomainEvent[] = [startedEvent]
    return this.#runAgentLoop(task, emittedEvents)
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
    if (task.agentId !== this.#agent.id) {
      throw new Error(`Task ${taskId} assigned to ${task.agentId}, not ${this.#agent.id}`)
    }

    return this.#runAgentLoop(task, [], response)
  }

  // ======================== agent loop ========================

  /**
   * Core agent execution loop.
   *
   * Loads conversation, builds AgentContext, runs the agent generator,
   * and delegates each yielded output to the OutputHandler.
   */
  async #runAgentLoop(
    task: TaskView,
    emittedEvents: DomainEvent[],
    pendingResponse?: UserInteractionRespondedPayload
  ): Promise<{ taskId: string; events: DomainEvent[] }> {
    const taskId = task.taskId

    // Load & repair conversation history
    const conversationHistory = await this.#conversationManager.loadAndRepair(
      taskId,
      this.#agent.id,
      this.#baseDir
    )

    const confirmedInteractionId = pendingResponse?.selectedOptionId === 'approve'
      ? pendingResponse.interactionId
      : undefined

    const persistMessage = this.#conversationManager.createPersistCallback(taskId, conversationHistory)

    // If user rejected a risky tool, inject rejection results BEFORE running agent
    if (pendingResponse && pendingResponse.selectedOptionId !== 'approve') {
      this.#injectRejectionResults(conversationHistory, persistMessage)
    }

    const context: AgentContext = {
      llm: this.#llm,
      tools: this.#toolRegistry,
      baseDir: this.#baseDir,
      conversationHistory,
      pendingInteractionResponse: pendingResponse,
      persistMessage
    }

    const outputCtx: OutputContext = {
      taskId,
      agentId: this.#agent.id,
      baseDir: this.#baseDir,
      confirmedInteractionId,
      conversationHistory,
      persistMessage
    }

    try {
      // Drain any instructions queued while task was in-flight
      const queue = this.#pendingInstructions.get(taskId) ?? []
      this.#conversationManager.drainPendingInstructions(queue, conversationHistory, persistMessage)

      for await (const output of this.#agent.run(task, context)) {
        // Drain pending instructions between yields (if safe)
        this.#conversationManager.drainPendingInstructions(queue, conversationHistory, persistMessage)

        // Check for pause signal — only at safe conversation state
        if (this.#pausedTasks.has(taskId) && this.#conversationManager.isSafeToInject(conversationHistory)) {
          break
        }

        const result = await this.#outputHandler.handle(output, outputCtx)

        if (result.event) {
          this.#store.append(taskId, [result.event])
          emittedEvents.push(result.event)
        }

        if (result.pause) break
        if (result.terminal) break
      }
    } catch (error) {
      const failureEvent: DomainEvent = {
        type: 'TaskFailed',
        payload: {
          taskId,
          reason: error instanceof Error ? error.message || String(error) : String(error),
          authorActorId: this.#agent.id
        }
      }
      this.#store.append(taskId, [failureEvent])
      emittedEvents.push(failureEvent)
      throw error
    }

    return { taskId, events: emittedEvents }
  }

  // ======================== helpers ========================

  /**
   * Inject synthetic rejection tool results for dangling risky tool calls.
   *
   * Called before agent.run() when the user rejected a risky tool confirmation.
   * This way the agent never sees the rejection flow — it just finds
   * a `role: 'tool'` error message in history and can re-plan.
   */
  #injectRejectionResults(
    conversationHistory: readonly LLMMessage[],
    persistMessage: (m: LLMMessage) => void
  ): void {
    // Walk backwards to find the last assistant message with tool calls
    for (let i = conversationHistory.length - 1; i >= 0; i--) {
      const msg = conversationHistory[i]
      if (msg.role !== 'assistant') continue
      if (!msg.toolCalls || msg.toolCalls.length === 0) break

      for (const tc of msg.toolCalls) {
        const hasResult = conversationHistory.some(
          m => m.role === 'tool' && m.toolCallId === tc.toolCallId
        )
        if (!hasResult) {
          persistMessage({
            role: 'tool',
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            content: JSON.stringify({ isError: true, error: 'User rejected the request' })
          } as LLMMessage)
        }
      }
      break // Only process the last assistant message
    }
  }
}
