import type { DomainEvent, UserFeedbackPostedPayload } from '../domain/events.js'
import type { TaskView } from '../application/taskService.js'
import type { LLMClient } from '../domain/ports/llmClient.js'

// ============================================================================
// Agent Context
// ============================================================================

/**
 * Context provided to an Agent when running a task.
 * Contains all dependencies needed for task execution.
 */
export type AgentContext = {
  llm: LLMClient
  baseDir: string
}

// ============================================================================
// Agent Interface
// ============================================================================

/**
 * Agent interface - a strategy unit for handling tasks.
 *
 * Agents are NOT persistent listeners. They are instantiated/invoked
 * when a task is assigned to them. Different agents differ in:
 * - Their prompt strategies
 * - Their internal workflow logic
 *
 * Tasks are assigned an agentId at creation time.
 */
export interface Agent {
  /** Unique identifier for this agent */
  readonly id: string

  /** Human-readable display name */
  readonly displayName: string

  /**
   * Execute the task workflow.
   *
   * Yields DomainEvents as the agent progresses through its workflow:
   * - TaskStarted (optional)
   * - AgentPlanPosted
   * - PatchProposed
   * - TaskCompleted / TaskFailed
   *
   * @param task - The task to execute
   * @param context - Dependencies and configuration
   */
  run(task: TaskView, context: AgentContext): AsyncGenerator<DomainEvent>

  /**
   * Resume execution after user feedback.
   *
   * Called when the user provides feedback on a plan or patch,
   * allowing the agent to adjust and continue.
   *
   * @param task - The current task state
   * @param feedback - The user's feedback
   * @param context - Dependencies and configuration
   */
  resume?(
    task: TaskView,
    feedback: UserFeedbackPostedPayload,
    context: AgentContext
  ): AsyncGenerator<DomainEvent>
}
