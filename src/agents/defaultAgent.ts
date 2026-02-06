import type { Agent, AgentContext, AgentOutput } from './agent.js'
import type { TaskView } from '../application/taskService.js'
import type { ContextBuilder } from '../application/contextBuilder.js'
import type { LLMMessage } from '../domain/ports/llmClient.js'
import type { ToolCallRequest } from '../domain/ports/tool.js'
import { buildConfirmInteraction } from './displayBuilder.js'

// ============================================================================
// Default CoAuthor Agent - Tool Use Workflow
// ============================================================================

/**
 * Default CoAuthor Agent.
 *
 * Implements the UIP + Tool Use workflow:
 * 1. Enter tool loop: call LLM → yield tool calls → repeat
 * 2. Handle risky tools via UIP confirmation
 * 3. Complete or fail task
 *
 * Tool execution is handled by the Runtime — the agent simply yields
 * `{ kind: 'tool_call' }` and the result appears in `conversationHistory`
 * as a `role: 'tool'` message on the next iteration.
 */
export class DefaultCoAuthorAgent implements Agent {
  readonly id = 'agent_coauthor_default'
  readonly displayName = 'CoAuthor Default Agent'

  readonly #contextBuilder: ContextBuilder
  readonly #maxIterations: number

  constructor(opts: { contextBuilder: ContextBuilder; maxIterations?: number }) {
    this.#contextBuilder = opts.contextBuilder
    this.#maxIterations = opts.maxIterations ?? 50
  }

  async *run(task: TaskView, context: AgentContext): AsyncGenerator<AgentOutput> {
    yield* this.#toolLoop(task, context)
  }

  // ---------- pending tool calls (resume after pause / UIP) ----------

  /**
   * Process any pending tool calls from previous execution (e.g. after resume).
   * Checks for missing tool results in history and executes/rejects them.
   */
  async *#processPendingToolCalls(context: AgentContext): AsyncGenerator<AgentOutput> {
    const lastMessage = context.conversationHistory[context.conversationHistory.length - 1]
    if (!lastMessage || lastMessage.role !== 'assistant' || !lastMessage.toolCalls || lastMessage.toolCalls.length === 0) {
      return
    }

    const pendingCalls = lastMessage.toolCalls.filter(tc =>
      !context.conversationHistory.some(
        m => m.role === 'tool' && m.toolCallId === tc.toolCallId
      )
    )
    if (pendingCalls.length === 0) return

    for (const toolCall of pendingCalls) {
      const tool = context.tools.get(toolCall.toolName)
      if (!tool) {
        yield { kind: 'error', content: `Unknown tool in pending call: ${toolCall.toolName}` }
        continue
      }

      if (tool.riskLevel === 'risky') {
        if (context.confirmedInteractionId) {
          yield* this.#executeToolCall(toolCall)
        } else if (context.pendingInteractionResponse) {
          // Response exists but not approval → rejection
          yield { kind: 'verbose', content: `Skipping tool ${toolCall.toolName}: User rejected.` }
          context.persistMessage({
            role: 'tool',
            toolCallId: toolCall.toolCallId,
            toolName: toolCall.toolName,
            content: JSON.stringify({ isError: true, error: 'User rejected the request' })
          })
        } else {
          // No response yet → request confirmation
          yield { kind: 'interaction', request: buildConfirmInteraction(toolCall) }
        }
      } else {
        yield* this.#executeToolCall(toolCall)
      }
    }
  }

  // ---------- main tool loop ----------

  /**
   * Main tool execution loop.
   * Calls LLM, yields tool calls, repeats until done or max iterations.
   */
  async *#toolLoop(task: TaskView, context: AgentContext): AsyncGenerator<AgentOutput> {
    // Seed conversation if fresh
    if (context.conversationHistory.length === 0) {
      context.persistMessage({ role: 'system', content: this.#contextBuilder.buildSystemPrompt() })
      context.persistMessage({ role: 'user', content: this.#buildTaskPrompt(task) })
    }

    // Process any pending tool calls from previous execution
    yield* this.#processPendingToolCalls(context)

    let iteration = 0
    while (iteration < this.#maxIterations) {
      iteration++
      yield { kind: 'verbose', content: `[Iteration ${iteration}] Calling LLM...` }

      const toolDefs = context.tools.list().map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters
      }))

      const messages: LLMMessage[] = [...context.conversationHistory]
      const llmResponse = await context.llm.complete({
        profile: 'fast',
        messages,
        tools: toolDefs,
        maxTokens: 4096
      })

      // Persist assistant message
      if (llmResponse.content || llmResponse.reasoning || llmResponse.toolCalls) {
        context.persistMessage({
          role: 'assistant',
          content: llmResponse.content,
          reasoning: llmResponse.reasoning,
          toolCalls: llmResponse.toolCalls
        })

        if (llmResponse.reasoning) {
          yield { kind: 'reasoning', content: llmResponse.reasoning }
        }
        if (llmResponse.content) {
          yield { kind: 'text', content: llmResponse.content }
        }
      }

      // No tool calls → done
      if (!llmResponse.toolCalls || llmResponse.toolCalls.length === 0) {
        yield { kind: 'done', summary: llmResponse.content || 'Task completed' }
        return
      }

      // Process tool calls
      for (const toolCall of llmResponse.toolCalls) {
        const tool = context.tools.get(toolCall.toolName)
        if (!tool) {
          yield { kind: 'error', content: `Unknown tool: ${toolCall.toolName}` }
          continue
        }

        if (tool.riskLevel === 'risky') {
          if (context.confirmedInteractionId) {
            yield* this.#executeToolCall(toolCall)
          } else {
            yield { kind: 'interaction', request: buildConfirmInteraction(toolCall) }
            return // Pause for confirmation
          }
        } else {
          yield* this.#executeToolCall(toolCall)
        }
      }
    }

    yield { kind: 'failed', reason: `Max iterations (${this.#maxIterations}) reached without completion` }
  }

  // ---------- tool call ----------

  /**
   * Yield a tool call for execution by the Runtime.
   *
   * The Runtime handles execution and result persistence.
   * The agent just signals intent.
   */
  async *#executeToolCall(toolCall: ToolCallRequest): AsyncGenerator<AgentOutput> {
    yield { kind: 'verbose', content: `Executing tool: ${toolCall.toolName}` }
    yield { kind: 'tool_call', call: toolCall }
  }

  // ---------- prompt building ----------

  #buildTaskPrompt(task: TaskView): string {
    let prompt = `# Task\n\n**Title:** ${task.title}\n\n`

    if (task.intent) {
      prompt += `**Intent:**\n${task.intent}\n\n`
    }

    if (task.artifactRefs && task.artifactRefs.length > 0) {
      prompt += `**Referenced Files:**\n`
      for (const ref of task.artifactRefs) {
        if (typeof ref === 'object' && 'path' in ref) {
          prompt += `- ${ref.path}\n`
        } else {
          prompt += `- ${JSON.stringify(ref)}\n`
        }
      }
      prompt += '\n'
    }

    prompt += `Please analyze this task and use the available tools to complete it. When done, provide a summary of what was accomplished.`
    return prompt
  }
}

