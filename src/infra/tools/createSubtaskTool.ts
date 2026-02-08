/**
 * SubAgent Tool Factory
 *
 * Creates a `create_subtask_<agentId>` tool for each registered agent.
 * When invoked by an LLM:
 *   1. Creates a child task assigned to the target agent.
 *   2. Waits (blocks) until the child reaches a terminal state.
 *   3. Returns the child's outcome as a structured result.
 *
 * The tool subscribes to `EventStore.events$` for event-driven waiting
 * (no expensive projection polling). Supports AbortSignal for immediate
 * cancel/pause propagation — both cancel and pause abort the wait so the
 * parent tool unblocks promptly.
 *
 * **Hardened against missed-event deadlocks (RD-001)**: After creating
 * the child task, a catch-up check reads the child's current state. If
 * the child already reached a terminal state before the subscription's
 * filter activated, the tool resolves immediately.
 *
 * **Bounded waits (RD-001)**: A configurable timeout (default 5 min)
 * prevents indefinite blocking. On timeout the child's current state
 * is read — if terminal, the result is returned; otherwise an error.
 */

import type { Tool, ToolContext, ToolResult, ToolRegistry } from '../../domain/ports/tool.js'
import type { EventStore } from '../../domain/ports/eventStore.js'
import type { StoredEvent } from '../../domain/events.js'
import type { TaskService, TaskView } from '../../application/taskService.js'
import type { ConversationStore } from '../../domain/ports/conversationStore.js'
import type { RuntimeManager } from '../../agents/runtimeManager.js'

// ============================================================================
// Types
// ============================================================================

export type SubtaskToolDeps = {
  store: EventStore
  taskService: TaskService
  conversationStore: ConversationStore
  runtimeManager: RuntimeManager
  maxSubtaskDepth: number
  /** Maximum time to wait for child task completion (ms). Default: 300_000 (5 min). */
  subtaskTimeoutMs?: number
}

export type SubtaskToolResult = {
  taskId: string
  agentId: string
  subTaskStatus: 'Success' | 'Error' | 'Cancel'
  summary?: string
  failureReason?: string
  finalAssistantMessage?: string
}

// ============================================================================
// Depth Computation
// ============================================================================

/**
 * Walk the parentTaskId chain to compute the current nesting depth.
 * Returns 0 for a root task, 1 for its direct subtask, etc.
 *
 * Includes cycle detection: if a cycle is encountered, returns Infinity
 * so the caller's depth check reliably rejects the subtask (PR-002).
 */
async function computeDepth(
  taskService: TaskService,
  taskId: string
): Promise<number> {
  let depth = 0
  const visited = new Set<string>()
  let current: TaskView | null = await taskService.getTask(taskId)
  while (current?.parentTaskId) {
    if (visited.has(current.parentTaskId)) {
      return Infinity // Cycle detected
    }
    visited.add(current.parentTaskId)
    depth++
    current = await taskService.getTask(current.parentTaskId)
  }
  return depth
}

// ============================================================================
// Extract Final Assistant Message
// ============================================================================

async function extractFinalAssistantMessage(
  conversationStore: ConversationStore,
  childTaskId: string
): Promise<string | undefined> {
  try {
    const messages = await conversationStore.getMessages(childTaskId)
    // Walk backwards to find the last assistant message with content
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role === 'assistant' && msg.content) {
        return msg.content
      }
    }
  } catch {
    // If conversation store fails, don't block the result
  }
  return undefined
}

// ============================================================================
// Tool Factory
// ============================================================================

/**
 * Create a `create_subtask_<agentId>` tool for the given agent.
 *
 * The tool is registered as `safe` (no UIP confirmation) and blocks
 * the parent agent until the child task completes.
 */
export function createSubtaskTool(
  agentId: string,
  agentDisplayName: string,
  agentDescription: string,
  deps: SubtaskToolDeps
): Tool {
  const {
    store, taskService, conversationStore, runtimeManager, maxSubtaskDepth,
    subtaskTimeoutMs = 300_000  // 5 minutes default
  } = deps

  return {
    name: `create_subtask_${agentId}`,
    description: `Delegate a subtask to the "${agentDisplayName}" agent. ${agentDescription} Creates a child task, waits for it to complete, and returns the result.`,
    parameters: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Short title describing the subtask.'
        },
        intent: {
          type: 'string',
          description: 'Detailed instructions for the subtask agent.'
        },
        priority: {
          type: 'string',
          description: 'Task priority.',
          enum: ['foreground', 'normal', 'background']
        }
      },
      required: ['title']
    },
    riskLevel: 'safe',

    async execute(
      args: Record<string, unknown>,
      ctx: ToolContext
    ): Promise<ToolResult> {
      const title = args.title as string
      const intent = (args.intent as string) ?? ''
      const priority = (args.priority as 'foreground' | 'normal' | 'background') ?? 'normal'

      // --- Depth check ---
      const currentDepth = await computeDepth(taskService, ctx.taskId)
      if (currentDepth >= maxSubtaskDepth) {
        return {
          toolCallId: '', // Overridden by executor
          output: JSON.stringify({
            error: `Maximum subtask nesting depth (${maxSubtaskDepth}) exceeded. Current depth: ${currentDepth}.`
          }),
          isError: true
        }
      }

      // --- Require RuntimeManager to be running (RD-004) ---
      // Lifecycle ownership belongs to the application layer, not tools.
      if (!runtimeManager.isRunning) {
        return {
          toolCallId: '',
          output: JSON.stringify({
            error: 'RuntimeManager must be started before creating subtasks. ' +
              'Ensure runtimeManager.start() is called at application initialization.'
          }),
          isError: true
        }
      }

      // --- Early abort check ---
      if (ctx.signal?.aborted) {
        const result: SubtaskToolResult = {
          taskId: '',
          agentId,
          subTaskStatus: 'Cancel',
          failureReason: 'Parent task was canceled or paused'
        }
        return {
          toolCallId: '',
          output: JSON.stringify(result),
          isError: false
        }
      }

      // --- Subscribe to terminal events BEFORE creating child task ---
      // This eliminates any race between task creation and event subscription.
      let childTaskId = ''
      let cleanupWatcher: () => void = () => {}

      const terminalPromise = new Promise<StoredEvent>((resolve, reject) => {
        const subscription = store.events$.subscribe((event: StoredEvent) => {
          if (!childTaskId || event.streamId !== childTaskId) return

          const isTerminal =
            event.type === 'TaskCompleted' ||
            event.type === 'TaskFailed' ||
            event.type === 'TaskCanceled'

          if (isTerminal) {
            cleanup()
            resolve(event)
          }
        })

        const onAbort = () => {
          cleanup()
          reject(new DOMException('Subtask wait aborted', 'AbortError'))
        }
        ctx.signal?.addEventListener('abort', onAbort, { once: true })

        // Timeout to prevent indefinite blocking (RD-001)
        let timeoutId: ReturnType<typeof setTimeout> | undefined
        if (subtaskTimeoutMs > 0) {
          timeoutId = setTimeout(() => {
            cleanup()
            reject(new Error(`Subtask wait timed out after ${subtaskTimeoutMs}ms`))
          }, subtaskTimeoutMs)
        }

        function cleanup() {
          subscription.unsubscribe()
          ctx.signal?.removeEventListener('abort', onAbort)
          if (timeoutId !== undefined) clearTimeout(timeoutId)
        }
        cleanupWatcher = cleanup
      })

      // --- Create child task (subscription already active) ---
      const createResult = await taskService.createTask({
        title,
        intent,
        priority,
        agentId,
        parentTaskId: ctx.taskId,
        authorActorId: ctx.actorId
      })
      childTaskId = createResult.taskId

      // --- Catch-up check (RD-001) ---
      // If the child task already reached a terminal state before the
      // subscription filter activated (fast child), resolve immediately
      // instead of waiting for a live event that already passed.
      const catchUpTask = await taskService.getTask(childTaskId)
      if (catchUpTask && isTerminalStatus(catchUpTask.status)) {
        cleanupWatcher()
        return buildResultFromTaskView(catchUpTask, childTaskId, agentId, conversationStore)
      }

      // --- Wait for terminal event ---
      try {
        const terminalEvent = await terminalPromise

        const finalMessage = await extractFinalAssistantMessage(conversationStore, childTaskId)

        let result: SubtaskToolResult

        switch (terminalEvent.type) {
          case 'TaskCompleted':
            result = {
              taskId: childTaskId,
              agentId,
              subTaskStatus: 'Success',
              summary: terminalEvent.payload.summary,
              finalAssistantMessage: finalMessage
            }
            break
          case 'TaskFailed':
            result = {
              taskId: childTaskId,
              agentId,
              subTaskStatus: 'Error',
              failureReason: terminalEvent.payload.reason,
              finalAssistantMessage: finalMessage
            }
            break
          case 'TaskCanceled':
            result = {
              taskId: childTaskId,
              agentId,
              subTaskStatus: 'Cancel',
              failureReason: terminalEvent.payload.reason
            }
            break
          default:
            result = {
              taskId: childTaskId,
              agentId,
              subTaskStatus: 'Error',
              failureReason: 'Unexpected terminal event type'
            }
        }

        return {
          toolCallId: '',
          output: JSON.stringify(result),
          isError: result.subTaskStatus === 'Error'
        }
      } catch (error) {
        // AbortSignal was triggered — cascade cancel to child
        if (error instanceof DOMException && error.name === 'AbortError') {
          await cascadeCancelChild(taskService, childTaskId)
          const result: SubtaskToolResult = {
            taskId: childTaskId || '',
            agentId,
            subTaskStatus: 'Cancel',
            failureReason: 'Parent task was canceled or paused'
          }
          return {
            toolCallId: '',
            output: JSON.stringify(result),
            isError: false
          }
        }

        // Timeout — check child state before failing
        if (error instanceof Error && error.message.includes('timed out')) {
          const timedOutTask = await taskService.getTask(childTaskId)
          if (timedOutTask && isTerminalStatus(timedOutTask.status)) {
            return buildResultFromTaskView(timedOutTask, childTaskId, agentId, conversationStore)
          }
          // Child still running — report timeout error
          const result: SubtaskToolResult = {
            taskId: childTaskId,
            agentId,
            subTaskStatus: 'Error',
            failureReason: `Subtask timed out after ${subtaskTimeoutMs}ms and is still running`
          }
          return {
            toolCallId: '',
            output: JSON.stringify(result),
            isError: true
          }
        }

        throw error
      } finally {
        cleanupWatcher()
      }
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

const TERMINAL_STATUSES = new Set(['done', 'failed', 'canceled'])

function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status)
}

/**
 * Best-effort cancel of a child task.
 */
async function cascadeCancelChild(taskService: TaskService, childTaskId: string): Promise<void> {
  if (!childTaskId) return
  try {
    const childTask = await taskService.getTask(childTaskId)
    if (childTask && !isTerminalStatus(childTask.status)) {
      await taskService.cancelTask(childTaskId, 'Parent task canceled')
    }
  } catch {
    // Best-effort cancel
  }
}

/**
 * Build a tool result from a terminal TaskView (used for catch-up and timeout recovery).
 */
async function buildResultFromTaskView(
  task: TaskView,
  childTaskId: string,
  agentId: string,
  conversationStore: ConversationStore
): Promise<ToolResult> {
  const finalMessage = await extractFinalAssistantMessage(conversationStore, childTaskId)

  let result: SubtaskToolResult
  switch (task.status) {
    case 'done':
      result = { taskId: childTaskId, agentId, subTaskStatus: 'Success', summary: task.summary, finalAssistantMessage: finalMessage }
      break
    case 'failed':
      result = { taskId: childTaskId, agentId, subTaskStatus: 'Error', failureReason: task.failureReason, finalAssistantMessage: finalMessage }
      break
    case 'canceled':
      result = { taskId: childTaskId, agentId, subTaskStatus: 'Cancel', failureReason: 'Task was canceled' }
      break
    default:
      result = { taskId: childTaskId, agentId, subTaskStatus: 'Error', failureReason: `Unexpected status: ${task.status}` }
  }

  return {
    toolCallId: '',
    output: JSON.stringify(result),
    isError: result.subTaskStatus === 'Error'
  }
}

// ============================================================================
// Registration Helper
// ============================================================================

/**
 * Register `create_subtask_<agentId>` tools for all registered agents.
 */
export function registerSubtaskTools(
  toolRegistry: ToolRegistry,
  deps: SubtaskToolDeps
): void {
  const { runtimeManager } = deps

  for (const [agentId, agent] of runtimeManager.agents) {
    const tool = createSubtaskTool(agentId, agent.displayName, agent.description, deps)
    toolRegistry.register(tool)
  }
}
