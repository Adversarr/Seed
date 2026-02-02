import { nanoid } from 'nanoid'
import type { Agent, AgentContext } from './agent.js'
import type { DomainEvent, Plan, UserFeedbackPostedPayload } from '../domain/events.js'
import { PlanSchema } from '../domain/events.js'
import type { TaskView } from '../application/taskService.js'
import type { ContextBuilder } from '../application/contextBuilder.js'

// ============================================================================
// Default CoAuthor Agent
// ============================================================================

function fallbackPlan(task: TaskView, raw: string, parseError?: unknown): Plan {
  return {
    goal: `Plan for: ${task.title}`,
    strategy: 'Fallback plan due to invalid model output',
    scope: 'Default agent execution',
    issues: [
      `parse_error=${parseError instanceof Error ? parseError.message : String(parseError)}`,
      `raw_output_length=${raw.length}`,
      `raw_preview=${raw.slice(0, 500).replace(/\n/g, '\\n')}`
    ],
    risks: ['LLM output was unparseable - review raw_preview in issues'],
    questions: []
  }
}

/**
 * Default CoAuthor Agent.
 *
 * This is the V0 default agent that handles all tasks.
 * It follows the Plan-first workflow:
 * 1. Build context from task and artifact refs
 * 2. Generate a plan using LLM
 * 3. Emit AgentPlanPosted event
 *
 * Future versions may add:
 * - Patch generation (M2)
 * - Self-check / LaTeX compilation
 * - Resume after user feedback
 */
export class DefaultCoAuthorAgent implements Agent {
  readonly id = 'agent_coauthor_default'
  readonly displayName = 'CoAuthor Default Agent'

  readonly #contextBuilder: ContextBuilder

  constructor(opts: { contextBuilder: ContextBuilder }) {
    this.#contextBuilder = opts.contextBuilder
  }

  async *run(task: TaskView, context: AgentContext): AsyncGenerator<DomainEvent> {
    // Step 1: Build context
    const messages = this.#contextBuilder.buildTaskMessages(task)

    // Step 2: Generate plan via LLM
    const raw = await context.llm.complete({
      profile: 'fast',
      messages,
      maxTokens: 1024 // TODO: Make this configurable in the future.
    })

    // Step 3: Parse plan (with fallback)
    let plan: Plan
    try {
      const parsed = JSON.parse(raw) as unknown
      plan = PlanSchema.parse(parsed)
    } catch (err) {
      plan = fallbackPlan(task, raw, err)
    }

    // Step 4: Emit AgentPlanPosted
    const planId = `plan_${nanoid(12)}`
    yield {
      type: 'AgentPlanPosted',
      payload: {
        taskId: task.taskId,
        planId,
        plan,
        authorActorId: this.id
      }
    }
  }

  async *resume(
    _task: TaskView,
    _feedback: UserFeedbackPostedPayload,
    _context: AgentContext
  ): AsyncGenerator<DomainEvent> {
    // TODO: Implement resume logic for M2
    // For now, this is a no-op
  }
}
