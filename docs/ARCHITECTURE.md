# Seed Architecture

## Overview

Seed is an event-sourced, task-oriented AI orchestration system for general goal execution in a local workspace.

Core principles:
- **Task as unit of work**: every agent run is attached to a task stream.
- **Event sourcing for decisions**: task lifecycle and user interactions are persisted as domain events.
- **Audit separation for execution**: tool-call execution data is persisted separately from domain events.
- **Policy-aware risk control**: tool risk is evaluated per call; enforced risky actions still require explicit confirmation.
- **Progressive skill activation**: skill metadata is visible in prompts; full skill instructions/resources load only on explicit activation.
- **Single-writer local runtime**: one master process owns local persistence; other clients attach remotely.

## Layered Design

Code is organized into explicit layers:

- `src/core/`
  - Entities, domain event contracts, and port interfaces.
- `src/application/`
  - Use-case services (`TaskService`, `InteractionService`, `EventService`, `AuditService`) and projection logic.
- `src/agents/`
  - Agent abstractions and orchestration (`RuntimeManager`, `AgentRuntime`, `OutputHandler`, `ConversationManager`).
- `src/infrastructure/`
  - JSONL persistence, filesystem adapters, LLM clients, built-in tools, HTTP/WS server, remote adapters.
- `src/interfaces/`
  - Composition root (`createApp`, `createRemoteApp`), CLI, and TUI adapters.
- `web/`
  - React SPA for dashboard/task/activity/settings.

## Runtime Modes

### 1) Master mode (local owner)

When no active lockfile-backed process exists for a workspace:
- CLI creates a local `App` via `createApp`.
- HTTP + WS server starts (`SeedServer`) on localhost (default port `3120`).
- Process writes lock file with `pid`, `port`, and auth token.
- `RuntimeManager` runs in-process and subscribes to event store stream.

### 2) Client mode (remote attach)

When a healthy master exists:
- CLI creates `App` via `createRemoteApp`.
- Services become HTTP/WS adapters (`RemoteTaskService`, `RemoteEventStore`, `RemoteUiBus`, etc.).
- UI code can run unchanged because remote app shape matches local app shape.

## End-to-End Flow

1. User creates task (TUI or Web UI).
2. `TaskService` appends `TaskCreated` event.
3. `RuntimeManager` receives event and creates task-scoped `AgentRuntime`.
4. Agent produces outputs (`text`, `reasoning`, `tool_call(s)`, `interaction`, `done`, `failed`).
5. `OutputHandler`:
   - emits UI events,
   - executes policy-safe tools directly,
   - requests UIP confirmation for risky tools,
   - appends task terminal events.
6. Tool execution is recorded in `audit.jsonl`; domain lifecycle stays in `events.jsonl`.
7. Conversation messages are durably stored in `conversations.jsonl` for recovery.

## Concurrency Model

`RuntimeManager` is the primary scheduler subscriber to `EventStore.events$` and serializes task operations with per-task `AsyncMutex`.
The `createSubtasks` wait path also uses scoped event subscriptions for child-terminal waits.

Implications:
- No overlapping handlers for the same `taskId`.
- Event-driven and manual task execution cannot race for one task.
- Pause/cancel remain lightweight signals with cooperative cancellation semantics.

## Persistence Model

Workspace-local data under `state/`:
- `state/events.jsonl` — domain events (task lifecycle + UIP)
- `state/projections.jsonl` — materialized projection cursor/state
- `state/audit.jsonl` — tool call request/completion trace
- `state/conversations.jsonl` — LLM conversation history

Implementations are append-oriented, async, and cache-backed (`JsonlEventStore`, `JsonlAuditLog`, `JsonlConversationStore`).

## Agent Catalog

Current built-in agents registered at app startup:
- `agent_seed_coordinator` (`DefaultSeedAgent`) — default execution and task-group delegation
- `agent_seed_research` (`SearchAgent`) — read-only workspace research
- `agent_seed_chat` (`MinimalAgent`) — chat-only advisory agent

`RuntimeManager` exposes global/default profile override, global streaming toggle, and global tool risk mode.

## Skill System (V1)

Workspace skills are discovered during app composition from `<workDir>/skills`.

Pipeline:
1. loader parses `SKILL.md` metadata (`name`, `description`) and registers normalized skill definitions.
2. runtime builds per-agent filtered skill views from `skillAllowlist`.
3. base agents inject metadata-only skill catalog into system prompt.
4. `activateSkill` tool performs explicit activation, consent-aware risk checks, and task-private resource mounting.

Current scope is workspace-only (no user/global skill tiers).

## Task Group + Workspace Scopes

Task groups are derived from hierarchy:
- each root task defines one group,
- descendants belong to that group.

Group-management tools:
- `createSubtasks`
- `listSubtask`

These tools are exposed only to top-level task runtimes (`parentTaskId` absent). Child runtimes do not receive `subtask` tool-group capabilities.

Tool paths use scoped workspace prefixes:
- `private:/...` maps to `private/<taskId>/...`
- `shared:/...` maps to `shared/<rootTaskId>/...`
- `public:/...` maps to `public/...`

Unscoped paths default to `private:/...` in runtime tool execution.

## Interfaces

- CLI (`src/interfaces/cli/run.ts`): `ui`, `serve`, `status`, `stop`.
- TUI (`src/interfaces/tui/*`): interactive terminal experience.
- Web UI (`web/`): HTTP for queries/commands + WS for realtime events.

## Key Invariants

- Domain decisions are append-only and replayable.
- Tool execution traces are auditable and separate from domain stream.
- Risky tool calls follow runtime risk policy; enforced risky calls still require explicit confirmation.
- Client-mode adapters do not bypass master-owned state transitions.
- Task stream processing is serialized per task.
