import type { Tool, ToolContext, ToolResult, ToolRegistry } from '../../core/ports/tool.js'
import type { EventStore } from '../../core/ports/eventStore.js'
import type { StoredEvent } from '../../core/events/events.js'
import type { TaskService, TaskView } from '../../application/services/taskService.js'
import type { ConversationStore } from '../../core/ports/conversationStore.js'
import type { RuntimeManager } from '../../agents/orchestration/runtimeManager.js'
import { nanoid } from 'nanoid'

export type AgentGroupToolDeps = {
  store: EventStore
  taskService: TaskService
  conversationStore: ConversationStore
  runtimeManager: RuntimeManager
  /**
   * Maximum wait duration per child when wait='all'.
   * Default: 300_000 ms.
   */
  subtaskTimeoutMs?: number
}

type CreateSubtasksTaskInput = {
  agentId: string
  title: string
  intent?: string
  priority?: 'foreground' | 'normal' | 'background'
}

type CreatedTaskInfo = {
  taskId: string
  agentId: string
  title: string
}

type ChildOutcome = {
  taskId: string
  agentId: string
  title: string
  status: 'Pending' | 'Success' | 'Error' | 'Cancel'
  summary?: string
  failureReason?: string
  finalAssistantMessage?: string
}

const TERMINAL_STATUSES = new Set(['done', 'failed', 'canceled'])

export function createSubtasksTool(deps: AgentGroupToolDeps): Tool {
  const timeoutMs = deps.subtaskTimeoutMs ?? 300_000

  return {
    name: 'createSubtasks',
    description: 'Create multiple subtasks (agent group members) for the current top-level task. Optionally wait for all subtasks to finish.',
    parameters: {
      type: 'object',
      properties: {
        tasks: {
          type: 'array',
          description: 'Subtasks to create. Each item targets one agent.',
          items: {
            type: 'object',
            properties: {
              agentId: { type: 'string', description: 'Target agent ID for this subtask.' },
              title: { type: 'string', description: 'Short title for the subtask.' },
              intent: { type: 'string', description: 'Detailed instruction for the subtask agent.' },
              priority: {
                type: 'string',
                description: 'Optional task priority.',
                enum: ['foreground', 'normal', 'background']
              }
            },
            required: ['agentId', 'title']
          }
        },
        wait: {
          type: 'string',
          description: 'Wait mode: all (default) waits for terminal outcomes; none returns immediately.',
          enum: ['all', 'none']
        }
      },
      required: ['tasks']
    },
    riskLevel: 'safe',
    group: 'subtask',

    async execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const toolCallId = `tool_${nanoid(12)}`
      const waitMode = (args.wait as 'all' | 'none' | undefined) ?? 'all'
      const inputs = (args.tasks as CreateSubtasksTaskInput[] | undefined) ?? []

      if (waitMode !== 'all' && waitMode !== 'none') {
        return errorResult(toolCallId, "wait must be either 'all' or 'none'")
      }

      if (!Array.isArray(inputs) || inputs.length === 0) {
        return errorResult(toolCallId, 'tasks must be a non-empty array')
      }

      const callerTask = await deps.taskService.getTask(ctx.taskId)
      if (!callerTask) {
        return errorResult(toolCallId, `Caller task not found: ${ctx.taskId}`)
      }
      if (callerTask.parentTaskId) {
        return errorResult(toolCallId, 'createSubtasks is only available to top-level tasks')
      }
      if (!deps.runtimeManager.isRunning) {
        return errorResult(
          toolCallId,
          'RuntimeManager must be started before creating subtasks. Ensure runtimeManager.start() is called at application initialization.'
        )
      }

      for (const input of inputs) {
        if (!input || typeof input !== 'object') {
          return errorResult(toolCallId, 'Each task must be an object')
        }
        if (!input.agentId || typeof input.agentId !== 'string') {
          return errorResult(toolCallId, 'Each task requires both agentId and title')
        }
        if (!input.title || typeof input.title !== 'string') {
          return errorResult(toolCallId, 'Each task requires both agentId and title')
        }
      }

      const createdTasks: CreatedTaskInfo[] = []
      for (const input of inputs) {
        const created = await deps.taskService.createTask({
          title: input.title,
          intent: input.intent ?? '',
          priority: input.priority ?? 'normal',
          agentId: input.agentId,
          parentTaskId: ctx.taskId,
          authorActorId: ctx.actorId
        })

        createdTasks.push({
          taskId: created.taskId,
          agentId: input.agentId,
          title: input.title
        })
      }

      if (waitMode === 'none') {
        const pendingTasks: ChildOutcome[] = createdTasks.map((task) => ({
          ...task,
          status: 'Pending'
        }))
        return okResult(toolCallId, {
          groupId: ctx.taskId,
          wait: waitMode,
          tasks: pendingTasks
        })
      }

      const outcomes = await Promise.all(
        createdTasks.map((task) =>
          waitForChildOutcome({
            child: task,
            deps,
            timeoutMs,
            signal: ctx.signal
          })
        )
      )

      const successCount = outcomes.filter((outcome) => outcome.status === 'Success').length
      const errorCount = outcomes.filter((outcome) => outcome.status === 'Error').length
      const cancelCount = outcomes.filter((outcome) => outcome.status === 'Cancel').length

      return okResult(toolCallId, {
        groupId: ctx.taskId,
        wait: waitMode,
        summary: {
          total: outcomes.length,
          success: successCount,
          error: errorCount,
          cancel: cancelCount
        },
        tasks: outcomes
      })
    }
  }
}

export function listSubtaskTool(deps: AgentGroupToolDeps): Tool {
  return {
    name: 'listSubtask',
    description: 'List all descendant subtasks in the current top-level task group.',
    parameters: {
      type: 'object',
      properties: {}
    },
    riskLevel: 'safe',
    group: 'subtask',

    async execute(_args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
      const toolCallId = `tool_${nanoid(12)}`
      const callerTask = await deps.taskService.getTask(ctx.taskId)
      if (!callerTask) {
        return errorResult(toolCallId, `Caller task not found: ${ctx.taskId}`)
      }
      if (callerTask.parentTaskId) {
        return errorResult(toolCallId, 'listSubtask is only available to top-level tasks')
      }

      const allTasks = (await deps.taskService.listTasks()).tasks
      const descendants = collectDescendants(allTasks, ctx.taskId)
      const statusCounts = {
        open: 0,
        in_progress: 0,
        awaiting_user: 0,
        paused: 0,
        done: 0,
        failed: 0,
        canceled: 0
      }

      for (const task of descendants) {
        statusCounts[task.status] += 1
      }

      return okResult(toolCallId, {
        groupId: ctx.taskId,
        total: descendants.length,
        statusCounts,
        tasks: descendants
          .slice()
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map((task) => ({
            taskId: task.taskId,
            title: task.title,
            agentId: task.agentId,
            status: task.status,
            parentTaskId: task.parentTaskId,
            childTaskIds: task.childTaskIds ?? [],
            summary: task.summary,
            failureReason: task.failureReason,
            createdAt: task.createdAt,
            updatedAt: task.updatedAt
          }))
      })
    }
  }
}

export function registerAgentGroupTools(toolRegistry: ToolRegistry, deps: AgentGroupToolDeps): void {
  toolRegistry.register(createSubtasksTool(deps))
  toolRegistry.register(listSubtaskTool(deps))
}

async function waitForChildOutcome(opts: {
  child: CreatedTaskInfo
  deps: AgentGroupToolDeps
  timeoutMs: number
  signal?: AbortSignal
}): Promise<ChildOutcome> {
  const { child, deps, timeoutMs, signal } = opts

  if (signal?.aborted) {
    await cascadeCancelChild(deps.taskService, child.taskId)
    return {
      ...child,
      status: 'Cancel',
      failureReason: 'Parent task was canceled or paused'
    }
  }

  let cleanup = () => {}
  const terminalEventPromise = new Promise<StoredEvent>((resolve, reject) => {
    const subscription = deps.store.events$.subscribe((event: StoredEvent) => {
      if (event.streamId !== child.taskId) return
      if (!isTerminalEvent(event)) return
      teardown()
      resolve(event)
    })

    const onAbort = () => {
      teardown()
      reject(new DOMException('Subtask wait aborted', 'AbortError'))
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    let timeoutId: ReturnType<typeof setTimeout> | undefined
    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        teardown()
        reject(new Error(`Subtask wait timed out after ${timeoutMs}ms`))
      }, timeoutMs)
    }

    function teardown(): void {
      subscription.unsubscribe()
      signal?.removeEventListener('abort', onAbort)
      if (timeoutId !== undefined) clearTimeout(timeoutId)
    }

    cleanup = teardown
  })

  // Catch-up check for very fast children that may finish before subscription filters run.
  const fastTask = await deps.taskService.getTask(child.taskId)
  if (fastTask && isTerminalStatus(fastTask.status)) {
    cleanup()
    return buildChildOutcomeFromTask(fastTask, child, deps.conversationStore)
  }

  try {
    await terminalEventPromise
    const terminalTask = await deps.taskService.getTask(child.taskId)
    if (!terminalTask) {
      return {
        ...child,
        status: 'Error',
        failureReason: 'Subtask disappeared before terminal state could be read'
      }
    }
    return buildChildOutcomeFromTask(terminalTask, child, deps.conversationStore)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      await cascadeCancelChild(deps.taskService, child.taskId)
      return {
        ...child,
        status: 'Cancel',
        failureReason: 'Parent task was canceled or paused'
      }
    }

    if (error instanceof Error && error.message.includes('timed out')) {
      const maybeTerminal = await deps.taskService.getTask(child.taskId)
      if (maybeTerminal && isTerminalStatus(maybeTerminal.status)) {
        return buildChildOutcomeFromTask(maybeTerminal, child, deps.conversationStore)
      }
      return {
        ...child,
        status: 'Error',
        failureReason: `Subtask timed out after ${timeoutMs}ms and is still running`
      }
    }

    return {
      ...child,
      status: 'Error',
      failureReason: error instanceof Error ? error.message : String(error)
    }
  } finally {
    cleanup()
  }
}

function isTerminalEvent(event: StoredEvent): boolean {
  return event.type === 'TaskCompleted' || event.type === 'TaskFailed' || event.type === 'TaskCanceled'
}

function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status)
}

async function cascadeCancelChild(taskService: TaskService, childTaskId: string): Promise<void> {
  try {
    const task = await taskService.getTask(childTaskId)
    if (task && !isTerminalStatus(task.status)) {
      await taskService.cancelTask(childTaskId, 'Parent task canceled')
    }
  } catch {
    // Best effort only.
  }
}

async function buildChildOutcomeFromTask(
  task: TaskView,
  child: CreatedTaskInfo,
  conversationStore: ConversationStore
): Promise<ChildOutcome> {
  if (task.status === 'done') {
    return {
      ...child,
      status: 'Success',
      summary: task.summary,
      finalAssistantMessage: await extractFinalAssistantMessage(conversationStore, task.taskId)
    }
  }
  if (task.status === 'failed') {
    return {
      ...child,
      status: 'Error',
      failureReason: task.failureReason,
      finalAssistantMessage: await extractFinalAssistantMessage(conversationStore, task.taskId)
    }
  }
  if (task.status === 'canceled') {
    return {
      ...child,
      status: 'Cancel',
      failureReason: 'Task was canceled'
    }
  }
  return {
    ...child,
    status: 'Error',
    failureReason: `Unexpected status: ${task.status}`
  }
}

async function extractFinalAssistantMessage(
  conversationStore: ConversationStore,
  taskId: string
): Promise<string | undefined> {
  try {
    const messages = await conversationStore.getMessages(taskId)
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      if (message.role === 'assistant' && message.content) {
        return message.content
      }
    }
  } catch {
    // Non-blocking best-effort extraction.
  }
  return undefined
}

function collectDescendants(allTasks: TaskView[], rootTaskId: string): TaskView[] {
  const byParent = new Map<string, TaskView[]>()
  for (const task of allTasks) {
    if (!task.parentTaskId) continue
    const siblings = byParent.get(task.parentTaskId) ?? []
    siblings.push(task)
    byParent.set(task.parentTaskId, siblings)
  }

  const descendants: TaskView[] = []
  const queue = [...(byParent.get(rootTaskId) ?? [])]
  while (queue.length > 0) {
    const current = queue.shift()!
    descendants.push(current)
    const children = byParent.get(current.taskId)
    if (children) queue.push(...children)
  }
  return descendants
}

function okResult(toolCallId: string, output: unknown): ToolResult {
  return {
    toolCallId,
    output,
    isError: false
  }
}

function errorResult(toolCallId: string, error: string): ToolResult {
  return {
    toolCallId,
    output: { error },
    isError: true
  }
}
