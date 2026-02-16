# Domain Model

## Task Aggregate

A task is the primary aggregate and stream identity (`streamId = taskId`).

Task shape (projected read model) includes:
- identity: `taskId`, `title`, `intent`, `createdBy`, `agentId`
- execution: `priority`, `status`
- interaction state: `pendingInteractionId`, `lastInteractionId`
- hierarchy: `parentTaskId`, `childTaskIds`
- terminal output: `summary`, `failureReason`
- metadata: `createdAt`, `updatedAt`, optional `artifactRefs`

## Task Status Lifecycle

Status enum:
- `open`
- `in_progress`
- `awaiting_user`
- `paused`
- `done`
- `failed`
- `canceled`

High-level transitions enforced by `TaskService.canTransition`:
- `open` → `in_progress` or `canceled`
- `in_progress` → `awaiting_user`, `done`, `failed`, `paused`, `canceled`
- `awaiting_user` → `in_progress` (via interaction response) or `canceled`
- `paused` → `in_progress`, `failed`, or `canceled`
- `done` may accept `TaskStarted` (explicit restart behavior)
- `failed` and `canceled` are terminal for new transitions

## Domain Events

Domain events are strict Zod-validated unions in `src/core/events/events.ts`.

Task lifecycle events:
- `TaskCreated`
- `TaskStarted`
- `TaskCompleted`
- `TaskFailed`
- `TaskCanceled`
- `TaskPaused`
- `TaskResumed`
- `TaskInstructionAdded`

User interaction events (UIP):
- `UserInteractionRequested`
- `UserInteractionResponded`

Stored event envelope adds:
- global `id`
- `streamId`
- per-stream `seq`
- `createdAt`

## UIP (Universal Interaction Protocol)

UIP request model:
- `kind`: `Select | Confirm | Input | Composite`
- `purpose`: e.g. `confirm_risky_action`, `choose_strategy`, `request_info`
- `display`: title/description/content/metadata
- optional `options` and validation hints

`InteractionService.respondToInteraction` validates stale/duplicate responses by ensuring response targets the **currently pending** interaction.

## Projection Model

Task list/read model is materialized by projection fold (`runProjection`):
- reads events after cursor,
- folds reducer,
- persists updated cursor/state.

Task projection is authoritative for app reads (`listTasks`, `getTask`).

## Artifact References

Task context can include artifact references:
- `file_range` (path + line range)
- `outline_anchor` (section id)
- `asset` (asset id)
- `citation` (cite key)

These are intent/context pointers, not direct state transitions.

## Subtask Semantics

Subtasks are normal tasks with `parentTaskId` set.

Agent-group management tools:
- `createSubtasks` creates one or more child tasks under the current top-level task.
- `listSubtask` lists all descendants in the current top-level task group.

Group model:
- one group per root task,
- group id = root task id,
- descendants are group members,
- root is treated as group-enabled after at least one child exists.

`createSubtasks` can wait for terminal outcomes (`wait='all'`) or return immediately (`wait='none'`).

## Scoped Workspace Semantics

Tool paths use explicit scope prefixes:
- `private:/...` task-private workspace
- `shared:/...` shared workspace for a task group
- `public:/...` repository/workspace root

Unscoped paths (`foo`, `/foo`) resolve to `private:/...`.

Disk mapping (no symlinks):
- private: `.seed/workspaces/private/<taskId>/...`
- shared: `.seed/workspaces/shared/<rootTaskId>/...`
- public: workspace root

Access rules:
- standalone root task cannot use `shared:/...`,
- descendants can use `shared:/...`,
- root can use `shared:/...` after child creation,
- `public:/...` is blocked from `.seed/workspaces/private/**` and `.seed/workspaces/shared/**`.

## Domain vs Audit Boundary

- **Domain events** model collaboration decisions and lifecycle state.
- **Audit log entries** model tool execution details.

This separation keeps replay/state logic stable while preserving full execution traceability.
