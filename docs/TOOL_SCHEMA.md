# Tool Schema and Execution Model

## Tool Contract

Tool interfaces are defined in `src/core/ports/tool.ts`.

A tool provides:
- `name`, `description`
- parameter JSON schema (`type: object`, `properties`, `required`)
- `riskLevel(args, ctx): safe | risky` (dynamic per-call evaluation)
- `group`: `search | edit | exec | subtask | meta`
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

Agent-group tools are registered after runtime/agent wiring:
- `createSubtasks`
- `listSubtask`

Skill activation tool is conditionally registered at app startup:
- `activateSkill` (`group: meta`, only when workspace skills are discovered)

## Risk Model

Risk is evaluated per tool call using `riskLevel(args, ctx)`.

Runtime risk modes:
- `autorun_all`: auto-run all non-enforced tools.
- `autorun_no_public` (default): auto-run except public-scope edits and enforced tools.
- `autorun_none`: no auto-run; risky calls require confirmation.

Enforced risky behavior:
- `runCommand` is always risky regardless of mode.

Dynamic risk behavior:
- `activateSkill` is risky on first activation of a task-visible skill, then safe for repeat activation in the same task session.

Path-aware behavior:
- `editFile` evaluates risk by mode and target scope (`private:/`, `shared:/`, `public:/`).
- Unscoped `editFile` paths are treated as `private:/`.

Risk boundary is enforced in orchestration/execution path, not by UI alone.

## Execution Context

Tool execution receives `ToolContext`:
- `taskId`, `actorId`, `baseDir`
- `artifactStore`
- optional `toolRiskMode` (defaults to `autorun_no_public`)
- optional `workspaceResolver` (scoped path resolution)
- optional `confirmedInteractionId` for approved risky actions
- optional `signal` for cooperative cancel/pause

## ToolExecutor Responsibilities

`ToolExecutor.execute()`:
1. resolve tool from registry,
2. evaluate call risk and validate confirmation constraints,
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
- re-run policy-safe tools if necessary,
- leave risky dangling calls for fresh confirmation.

## Notes on Current Built-ins

- `editFile` uses policy-aware risk by mode + path scope, supports exact/regex/flexible replacement and creation when `oldString=""`.
- `runCommand` is enforced risky, supports timeout, output truncation, optional background mode, and AbortSignal cancellation.
- task-group tools are `safe`; `createSubtasks(wait='all')` uses bounded child waits.
- `activateSkill` performs progressive disclosure (loads `SKILL.md` body only on activation) and mounts skill resources to `private:/.skills/<skillName>`.
