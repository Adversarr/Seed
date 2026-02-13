# Tool Schema and Execution Model

## Tool Contract

Tool interfaces are defined in `src/core/ports/tool.ts`.

A tool provides:
- `name`, `description`
- parameter JSON schema (`type: object`, `properties`, `required`)
- `riskLevel`: `safe | risky`
- `group`: `search | edit | exec | subtask`
- optional `canExecute(args, ctx)` preflight
- `execute(args, ctx)` implementation

## Registry and Exposure

`ToolRegistry` manages registration and lookup.

It supports:
- full tool listing,
- filtered listing by groups,
- export to OpenAI function format,
- filtered OpenAI export by groups.

Built-in registration (`registerBuiltinTools`) includes:
- `readFile`
- `editFile`
- `listFiles`
- `runCommand`
- `glob`
- `grep`

Subtask tools are generated per agent after agent registration:
- `create_subtask_<agentId>`

## Risk Model

- `safe` tools run immediately.
- `risky` tools require user confirmation via UIP.

Risk boundary is enforced in orchestration/execution path, not by UI alone.

## Execution Context

Tool execution receives `ToolContext`:
- `taskId`, `actorId`, `baseDir`
- `artifactStore`
- optional `confirmedInteractionId` for approved risky actions
- optional `signal` for cooperative cancel/pause

## ToolExecutor Responsibilities

`ToolExecutor.execute()`:
1. resolve tool from registry,
2. validate risk/confirmation constraints,
3. append audit `ToolCallRequested`,
4. execute tool,
5. append audit `ToolCallCompleted`,
6. return structured `ToolResult`.

`ToolExecutor.recordRejection()` persists deterministic rejection audit entries.

## OutputHandler Behavior

`OutputHandler` handles agent-emitted tool calls:
- single call flow,
- batched call flow with ordering barriers:
  - contiguous safe segments execute concurrently,
  - risky calls execute sequentially with confirmation checks.

UI bus emits lifecycle events:
- `tool_call_start`, `tool_call_heartbeat`, `tool_call_end`
- `tool_calls_batch_start`, `tool_calls_batch_end`

## Conversation Consistency

After execution, tool results are persisted to conversation history if missing.

`ConversationManager` also repairs dangling tool calls on recovery:
- recover from audit completion if present,
- re-run safe tools if necessary,
- leave risky dangling calls for fresh confirmation.

## Notes on Current Built-ins

- `editFile` is `risky`, supports exact/regex/flexible replacement and creation when `oldString=""`.
- `runCommand` is `risky`, supports timeout, output truncation, optional background mode, and AbortSignal cancellation.
- subtask tools are `safe` but bounded by max depth and wait timeout.
