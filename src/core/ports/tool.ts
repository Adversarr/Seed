/**
 * Domain Layer - Ports
 *
 * This module defines the Tool Use port interfaces.
 * Tools are the mechanism by which Agents interact with the external world.
 */

import { z } from 'zod'
import type { ArtifactStore } from './artifactStore.js'

// ============================================================================
// Tool Call Types
// ============================================================================

export const ToolCallRequestSchema = z.object({
  toolCallId: z.string().min(1),
  toolName: z.string().min(1),
  arguments: z.record(z.unknown())
})

export const ToolResultSchema = z.object({
  toolCallId: z.string().min(1),
  output: z.unknown(),
  isError: z.boolean()
})

export type ToolCallRequest = z.infer<typeof ToolCallRequestSchema>
export type ToolResult = z.infer<typeof ToolResultSchema>

// ============================================================================
// Tool Definition (for LLM)
// ============================================================================

export type JsonSchemaProperty = {
  type: string
  description?: string
  enum?: string[]
  items?: JsonSchemaProperty
  properties?: Record<string, JsonSchemaProperty>
  required?: string[]
}

export type ToolParametersSchema = {
  type: 'object'
  properties: Record<string, JsonSchemaProperty>
  required?: string[]
}

export type ToolDefinition = {
  name: string
  description: string
  parameters: ToolParametersSchema
}

// ============================================================================
// Tool Risk Level & Group
// ============================================================================

export type ToolRiskLevel = 'safe' | 'risky'
export const TOOL_RISK_MODES = ['autorun_all', 'autorun_no_public', 'autorun_none'] as const
export type ToolRiskMode = (typeof TOOL_RISK_MODES)[number]
export const DEFAULT_TOOL_RISK_MODE: ToolRiskMode = 'autorun_no_public'

export function resolveToolRiskMode(mode?: ToolRiskMode): ToolRiskMode {
  return mode ?? DEFAULT_TOOL_RISK_MODE
}

/** Logical grouping for controlling per-agent tool access. */
export type ToolGroup = 'search' | 'edit' | 'exec' | 'subtask'

// ============================================================================
// Workspace Path Resolution
// ============================================================================

/**
 * Logical workspace scopes used by tool paths.
 *
 * Examples:
 * - private:/src/index.ts
 * - shared:/artifacts/report.md
 * - public:/README.md
 */
export type WorkspaceScope = 'private' | 'shared' | 'public'

/**
 * Resolved concrete path information for file/dir style paths.
 */
export type WorkspacePathResolution = {
  /** Resolved logical scope. */
  scope: WorkspaceScope
  /**
   * Path under the scope root without prefix.
   * Empty string means the scope root itself.
   */
  pathInScope: string
  /** Scope-prefixed logical path (e.g. private:/foo/bar). */
  logicalPath: string
  /**
   * Scope root relative to workspace root.
   * Example: private/<taskId> or public
   */
  scopeRootStorePath: string
  /**
   * Path relative to workspace root for ArtifactStore operations.
   * Example: private/<taskId>/foo/bar
   */
  storePath: string
  /** Absolute filesystem path for process cwd operations. */
  absolutePath: string
}

/**
 * Resolved concrete path information for glob/search patterns.
 */
export type WorkspacePatternResolution = {
  scope: WorkspaceScope
  patternInScope: string
  logicalPattern: string
  scopeRootStorePath: string
  storePattern: string
  scopeRootAbsolutePath: string
}

/**
 * Optional resolver injected by runtime to implement scoped workspace rules.
 * When omitted, tools should fall back to legacy workspace-root semantics.
 */
export interface WorkspacePathResolver {
  resolvePath(
    taskId: string,
    rawPath: string,
    options?: { defaultScope?: WorkspaceScope }
  ): Promise<WorkspacePathResolution>

  resolvePattern(
    taskId: string,
    rawPattern: string,
    options?: { defaultScope?: WorkspaceScope }
  ): Promise<WorkspacePatternResolution>

  toLogicalPath(scope: WorkspaceScope, pathInScope: string): string
}

// ============================================================================
// Tool Context (for execution)
// ============================================================================

export type ToolContext = {
  taskId: string
  actorId: string
  baseDir: string
  artifactStore: ArtifactStore
  /**
   * Runtime policy that controls auto-run behavior for risky tools.
   * Defaults to `autorun_no_public` when omitted.
   */
  toolRiskMode?: ToolRiskMode
  /** Optional scoped workspace path resolver. */
  workspaceResolver?: WorkspacePathResolver
  /**
   * For risky tools: the interactionId of the UIP confirmation.
   * If a risky tool is called without this, the executor should reject.
   */
  confirmedInteractionId?: string
  /**
   * AbortSignal for cooperative cancellation.
   * Long-running tools (e.g. create_subtask) should listen for abort
   * to react immediately when the parent task is canceled or paused.
   */
  signal?: AbortSignal
}

// ============================================================================
// Tool Interface
// ============================================================================

/**
 * Tool interface - defines a capability that an Agent can invoke.
 *
 * Tools are registered in a ToolRegistry and executed via ToolExecutor.
 * Risky tools require user confirmation via UIP before execution.
 */
export interface Tool {
  /** Unique name for the tool */
  readonly name: string

  /** Human-readable description for LLM */
  readonly description: string

  /** JSON Schema for parameters */
  readonly parameters: ToolParametersSchema

  /** Dynamic risk evaluation - 'risky' tools require UIP confirmation */
  readonly riskLevel: (args: Record<string, unknown>, ctx: ToolContext) => ToolRiskLevel

  /** Logical group for per-agent tool access control */
  readonly group: ToolGroup

  /**
   * Optional pre-execution check to verify if the tool *can* be executed successfully.
   * This is called by the runtime BEFORE any risk assessment or execution.
   * 
   * Useful for:
   * - "Risky" tools to fail fast before asking for user confirmation (e.g. merge conflicts).
   * - "Safe" tools to validate preconditions without triggering execution side-effects.
   * 
   * @param args - Parsed arguments matching parameters schema
   * @param ctx - Execution context
   * @throws Error if the tool cannot be executed (e.g. preconditions failed).
   */
  canExecute?(args: Record<string, unknown>, ctx: ToolContext): Promise<void>

  /**
   * Execute the tool with given arguments.
   *
   * @param args - Parsed arguments matching parameters schema
   * @param ctx - Execution context
   * @returns Tool result (output or error)
   */
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>
}

export function evaluateToolRiskLevel(
  tool: Pick<Tool, 'riskLevel'>,
  args: Record<string, unknown>,
  ctx: ToolContext
): ToolRiskLevel {
  const mode = resolveToolRiskMode(ctx.toolRiskMode)
  if (ctx.toolRiskMode === mode) {
    return tool.riskLevel(args, ctx)
  }
  return tool.riskLevel(args, { ...ctx, toolRiskMode: mode })
}

// ============================================================================
// Tool Registry Interface
// ============================================================================

/**
 * ToolRegistry - manages available tools for Agents.
 */
export interface ToolRegistry {
  /**
   * Register a tool.
   */
  register(tool: Tool): void

  /**
   * Get a tool by name.
   */
  get(name: string): Tool | undefined

  /**
   * List all registered tools.
   */
  list(): Tool[]

  /**
   * List tools whose group is in the provided set.
   */
  listByGroups(groups: readonly ToolGroup[]): Tool[]

  /**
   * Get tool definitions in OpenAI format for LLM calls.
   */
  toOpenAIFormat(): Array<{
    type: 'function'
    function: ToolDefinition
  }>

  /**
   * Get filtered tool definitions in OpenAI format for specific groups.
   */
  toOpenAIFormatByGroups(groups: readonly ToolGroup[]): Array<{
    type: 'function'
    function: ToolDefinition
  }>
}

// ============================================================================
// Tool Executor Interface
// ============================================================================

/**
 * ToolExecutor - executes tools with audit logging and risk checking.
 *
 * The executor is responsible for:
 * 1. Looking up the tool in the registry
 * 2. Evaluating risk level - reject risky tools without confirmation
 * 3. Logging the request to AuditLog
 * 4. Executing the tool
 * 5. Logging the result to AuditLog
 * 6. Returning the result
 */
export interface ToolExecutor {
  /**
   * Execute a tool call.
   *
   * @param call - The tool call request
   * @param ctx - Execution context
   * @returns Tool result
   */
  execute(call: ToolCallRequest, ctx: ToolContext): Promise<ToolResult>

  /**
   * Record a user-rejected tool call in the audit log.
   *
   * Emits both ToolCallRequested and ToolCallCompleted (isError: true)
   * audit entries so the live TUI displays the request and rejection,
   * matching what /replay shows from conversation history.
   *
   * @param call - The rejected tool call request
   * @param ctx - Execution context
   * @returns Tool result with the rejection error
   */
  recordRejection(call: ToolCallRequest, ctx: ToolContext): ToolResult
}
