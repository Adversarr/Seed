import type { RuntimeManager } from '../../agents/orchestration/runtimeManager.js'
import type { TaskService, TaskView } from '../../application/services/taskService.js'
import type { LLMProfile } from '../../core/ports/llmClient.js'
import type { ToolGroup } from '../../core/ports/tool.js'

export type TaskGroupTaskInput = {
  agentId: string
  title: string
  intent?: string
  priority?: 'foreground' | 'normal' | 'background'
}

export type CreatedTaskGroupMember = {
  taskId: string
  agentId: string
  title: string
}

export type ViableTaskGroupAgent = {
  agentId: string
  displayName: string
  description: string
  toolGroups: ToolGroup[]
  defaultProfile: LLMProfile
  isDefault: boolean
  isCurrent: boolean
}

/**
 * Machine-readable error type for task-group creation and validation failures.
 *
 * These failures are client-actionable and should typically map to HTTP 400.
 */
export class TaskGroupCreationError extends Error {
  readonly code:
    | 'INVALID_INPUT'
    | 'CALLER_NOT_FOUND'
    | 'NOT_TOP_LEVEL'
    | 'RUNTIME_NOT_RUNNING'
    | 'UNKNOWN_AGENT_ID'

  constructor(
    code: TaskGroupCreationError['code'],
    message: string
  ) {
    super(message)
    this.name = 'TaskGroupCreationError'
    this.code = code
  }
}

/**
 * Build the list of viable sub-agents for the current top-level task.
 */
export function listViableTaskGroupAgents(
  runtimeManager: RuntimeManager,
  currentAgentId: string
): ViableTaskGroupAgent[] {
  const defaultAgentId = getDefaultAgentId(runtimeManager)

  return [...runtimeManager.agents.values()]
    .map((agent) => ({
      agentId: agent.id,
      displayName: agent.displayName,
      description: agent.description,
      toolGroups: [...agent.toolGroups],
      defaultProfile: agent.defaultProfile,
      isDefault: agent.id === defaultAgentId,
      isCurrent: agent.id === currentAgentId
    }))
    .sort((a, b) => a.agentId.localeCompare(b.agentId))
}

/**
 * Validate top-level caller constraints shared by tool and HTTP use-cases.
 */
export async function requireTopLevelCallerTask(
  taskService: TaskService,
  taskId: string,
  options: { notTopLevelMessage: string }
): Promise<TaskView> {
  const callerTask = await taskService.getTask(taskId)
  if (!callerTask) {
    throw new TaskGroupCreationError('CALLER_NOT_FOUND', `Caller task not found: ${taskId}`)
  }
  if (callerTask.parentTaskId) {
    throw new TaskGroupCreationError('NOT_TOP_LEVEL', options.notTopLevelMessage)
  }
  return callerTask
}

/**
 * Create task-group members (child tasks) under a top-level task.
 *
 * This function contains only create-time behavior (no waiting for outcomes).
 */
export async function createTaskGroupMembers(opts: {
  taskService: TaskService
  runtimeManager: RuntimeManager
  rootTaskId: string
  callerAgentId: string
  authorActorId?: string
  tasks: TaskGroupTaskInput[]
}): Promise<{ groupId: string; tasks: CreatedTaskGroupMember[] }> {
  const {
    taskService,
    runtimeManager,
    rootTaskId,
    callerAgentId,
    authorActorId,
    tasks
  } = opts

  if (!runtimeManager.isRunning) {
    throw new TaskGroupCreationError(
      'RUNTIME_NOT_RUNNING',
      'RuntimeManager must be started before creating subtasks. Ensure runtimeManager.start() is called at application initialization.'
    )
  }

  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new TaskGroupCreationError('INVALID_INPUT', 'tasks must be a non-empty array')
  }

  for (const task of tasks) {
    if (!task || typeof task !== 'object') {
      throw new TaskGroupCreationError('INVALID_INPUT', 'Each task must be an object')
    }
    if (!task.agentId || typeof task.agentId !== 'string') {
      throw new TaskGroupCreationError('INVALID_INPUT', 'Each task requires both agentId and title')
    }
    if (!task.title || typeof task.title !== 'string') {
      throw new TaskGroupCreationError('INVALID_INPUT', 'Each task requires both agentId and title')
    }
  }

  const viableAgents = listViableTaskGroupAgents(runtimeManager, callerAgentId)
  const viableAgentIds = new Set(viableAgents.map((agent) => agent.agentId))
  const invalidAgentIds = [...new Set(
    tasks
      .map((task) => task.agentId)
      .filter((agentId) => !viableAgentIds.has(agentId))
  )]

  if (invalidAgentIds.length > 0) {
    throw new TaskGroupCreationError(
      'UNKNOWN_AGENT_ID',
      `Unknown or unavailable agentId(s): ${invalidAgentIds.join(', ')}. Use listSubtask to discover viable sub-agents.`
    )
  }

  const createdMembers: CreatedTaskGroupMember[] = []
  for (const task of tasks) {
    const created = await taskService.createTask({
      title: task.title,
      intent: task.intent ?? '',
      priority: task.priority ?? 'normal',
      agentId: task.agentId,
      parentTaskId: rootTaskId,
      authorActorId
    })

    createdMembers.push({
      taskId: created.taskId,
      agentId: task.agentId,
      title: task.title
    })
  }

  return {
    groupId: rootTaskId,
    tasks: createdMembers
  }
}

function getDefaultAgentId(runtimeManager: RuntimeManager): string | undefined {
  try {
    return runtimeManager.defaultAgentId
  } catch {
    return undefined
  }
}
