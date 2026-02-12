import type { ContextBuilder } from '../../application/context/contextBuilder.js'
import type { LLMProfile } from '../../core/ports/llmClient.js'
import type { ToolGroup } from '../../core/ports/tool.js'
import { BaseToolAgent } from '../core/baseAgent.js'
import { DEFAULT_COAUTHOR_SYSTEM_PROMPT } from './templates.js'

// ============================================================================
// Default CoAuthor Agent - Tool Use Workflow
// ============================================================================

/**
 * Default CoAuthor Agent.
 *
 * Full-capability agent with access to all tool groups.
 * Implements the tool loop: call LLM → yield tool calls → repeat.
 *
 * The agent is risk-unaware. It yields tool call outputs without any risk
 * gating. The Runtime/OutputHandler intercepts risky tools and handles UIP
 * confirmation before execution — agents never need to know about risk.
 */
export class DefaultCoAuthorAgent extends BaseToolAgent {
  readonly id = 'agent_coauthor_default'
  readonly displayName = 'Default Agent'
  readonly description =
    'General-purpose agent that uses available tools to analyze tasks, edit files, and execute commands.'
  readonly toolGroups: readonly ToolGroup[] = ['search', 'edit', 'exec', 'subtask']
  readonly defaultProfile: LLMProfile

  constructor(opts: {
    contextBuilder: ContextBuilder
    maxIterations?: number
    maxTokens?: number
    defaultProfile?: LLMProfile
    systemPromptTemplate?: string
  }) {
    super({
      contextBuilder: opts.contextBuilder,
      maxIterations: opts.maxIterations,
      maxTokens: opts.maxTokens,
      systemPromptTemplate: opts.systemPromptTemplate ?? DEFAULT_COAUTHOR_SYSTEM_PROMPT
    })
    this.defaultProfile = opts.defaultProfile ?? 'fast'
  }
}
