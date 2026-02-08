# Coupling & Concurrency Review (V2): EventStore, Agent Runtime, Subtasks, and UIP

## Executive Summary

This document is the consolidated review of coupling complexity and concurrency hazards across the event-sourced task runtime, subtask delegation mechanism, and the Universal Interaction Protocol (UIP).

It merges and normalizes content from:
- [CONCURRENCY_BUGS_ANALYSIS.md](file:///Users/yangjerry/Repo/coauthor/docs/CONCURRENCY_BUGS_ANALYSIS.md) (external analysis, reviewed below)
- [REVIEW_COMPLEXITY.md](file:///Users/yangjerry/Repo/coauthor/docs/REVIEW_COMPLEXITY.md) (prior internal review)

The highest-impact issues remain:
- **Per-task serialization is missing**: event handlers can overlap, allowing multiple runtime entry points to run concurrently for the same task ([runtimeManager.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtimeManager.ts#L97-L107), [runtimeManager.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtimeManager.ts#L153-L248)).
- **Runtime single-flight is not enforced**: `execute()` and `resume()` do not guard against overlap, and the drain loop can clobber the execution flag ([runtime.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtime.ts#L168-L242)).
- **Subtask waits can deadlock**: `create_subtask_*` can miss the child’s terminal event and wait forever ([createSubtaskTool.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/tools/createSubtaskTool.ts#L175-L224)).
- **Risky-tool approvals are not action-bound**: confirmation is not cryptographically/structurally bound to a specific tool call, creating an authorization integrity gap ([toolExecutor.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/toolExecutor.ts#L106-L116), [runtime.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtime.ts#L266-L284)).
- **Pause/cancel semantics are non-atomic and tool-dependent**: tasks can continue side effects after pause/cancel, and strict state-machine checks can turn benign timing into exceptions ([runtime.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtime.ts#L313-L353), [taskService.ts](file:///Users/yangjerry/Repo/coauthor/src/application/taskService.ts#L201-L225)).

## Table of Contents

- [1. Scope and Method](#1-scope-and-method)
- [2. Step-by-Step Review of CONCURRENCY_BUGS_ANALYSIS](#2-step-by-step-review-of-concurrency_bugs_analysis)
  - [2.1 EventStore & Task - AgentRuntime - Agent](#21-eventstore--task---agentruntime---agent)
  - [2.2 Subagent](#22-subagent)
  - [2.3 User Interaction (UIP)](#23-user-interaction-uip)
  - [2.4 Review Summary](#24-review-summary)
- [3. Coupling Overview](#3-coupling-overview)
- [4. Merged Findings (Canonical List)](#4-merged-findings-canonical-list)
  - [4.1 Concurrency and Correctness](#41-concurrency-and-correctness)
  - [4.2 Reliability and Deadlocks](#42-reliability-and-deadlocks)
  - [4.3 Security and Authorization](#43-security-and-authorization)
  - [4.4 Performance and Resource Control](#44-performance-and-resource-control)
  - [4.5 Documentation and Consistency Gaps](#45-documentation-and-consistency-gaps)
- [5. Recommended Priorities (Non-Implementation)](#5-recommended-priorities-non-implementation)
- [Appendix A. Cross-Reference: Bug IDs vs Finding IDs](#appendix-a-cross-reference-bug-ids-vs-finding-ids)
- [Appendix B. Race Taxonomy (Practical)](#appendix-b-race-taxonomy-practical)

## 1. Scope and Method

This review focuses on coupling and concurrency risk across:
- Event sourcing and event routing: `EventStore` → `RuntimeManager` → `AgentRuntime`.
- Agent execution loop and side effects: `AgentRuntime` → `OutputHandler` → tools.
- Subtask delegation: `create_subtask_<agentId>` tooling and its event-driven waiting.
- UIP request/response lifecycle and risky-tool confirmation.

All findings are grounded in observable behavior in the code (file + exact line references included). Recommendations intentionally avoid full code solutions and detailed implementation steps.

## 2. Step-by-Step Review of CONCURRENCY_BUGS_ANALYSIS

This section reviews the external analysis finding-by-finding, and corrects places where the described race is not feasible in the current implementation.

### 2.1 EventStore & Task - AgentRuntime - Agent

#### [R-1.1] “TOCTOU race in `#executeAndDrainQueuedInstructions`” — Partially correct (root cause differs)

- **External bug ID**: 1.1
- **External claim**: Another invocation can slip between `if (this.#isExecuting) return` and `this.#isExecuting = true`.
- **Code location**: [runtime.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtime.ts#L222-L242)

**Review**
- The specific “check then context switch then set” timeline is not feasible as written, because there is no `await` between the check and the assignment in the current code path. In a single-threaded JS execution model, two calls cannot interleave within those two synchronous statements.
- However, the overall hazard (“single-flight is not guaranteed”) is real for a different reason: the drain loop sets `#isExecuting = true`, then calls `await this.execute()`, and `execute()` sets `#isExecuting = true` and then resets it to `false` in its `finally` block ([runtime.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtime.ts#L168-L196)). This clobbers the outer guard and can make the runtime appear idle while the drain loop is still in progress.

**Impact**
- Overlapping runs become possible via other entry points that do not guard (`resume()`, `executeTask()`), especially under overlapping `RuntimeManager` handlers.

**Suggested resolution (high-level)**
- Replace the boolean with a single-flight mechanism (per-task lock/queue), or make the “execution in progress” signal non-clobbering (ref-counted / state machine), and route all entry points through it.

#### [R-1.2] “Projection staleness during TaskCreated handling” — Incorrect (as described)

- **External bug ID**: 1.2
- **External claim**: The projection may not see `TaskCreated` yet because disk append is pending when the event is handled.
- **Code locations**:
  - Event append/emit: [jsonlEventStore.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/jsonlEventStore.ts#L113-L158)
  - Task lookup: [taskService.ts](file:///Users/yangjerry/Repo/coauthor/src/application/taskService.ts#L93-L107)
  - Handler: [runtimeManager.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtimeManager.ts#L153-L171)

**Review**
- `JsonlEventStore.append()` performs disk append and cache updates inside a mutex and only emits the event to subscribers after the write/cache update completes ([jsonlEventStore.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/jsonlEventStore.ts#L116-L157)).
- `TaskService.getTask()` reads from a projection built on the in-memory event cache via `readAll()`; it does not race the disk write after the event emission happens ([taskService.ts](file:///Users/yangjerry/Repo/coauthor/src/application/taskService.ts#L93-L107)).

**What remains true**
- Projection reads can still be inconsistent with runtime state in the sense of “two different control planes” (runtime flags vs projection state), but not because `TaskCreated` is missing while handling `TaskCreated`.

#### [R-1.3] “Concurrent access to `#runtimes` map can create two runtimes” — Incorrect (as described)

- **External bug ID**: 1.3
- **External claim**: Two handlers can both pass `get()` and create two runtimes for the same task due to a TOCTOU window.
- **Code location**: [runtimeManager.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtimeManager.ts#L273-L296)

**Review**
- `#getOrCreateRuntime()` is synchronous and does not contain `await`. Once a given handler reaches it, it will set the runtime in the map before yielding back to the event loop.
- The more realistic concurrency risk in `RuntimeManager` is not “duplicate runtime creation,” but “concurrent calls into the same runtime instance” because `#handleEvent()` intentionally fire-and-forgets handlers and does not serialize per `taskId` ([runtimeManager.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtimeManager.ts#L97-L107)).

### 2.2 Subagent

#### [R-2.1] “Terminal event subscription race (deadlock)” — Correct

- **External bug ID**: 2.1
- **Code location**: [createSubtaskTool.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/tools/createSubtaskTool.ts#L175-L224)

**Review**
- The subscription filters out events until `childTaskId` is set, but `childTaskId` is only assigned after `createTask()` resolves.
- A fast child task can reach a terminal state and emit `TaskCompleted`/`TaskFailed`/`TaskCanceled` before `childTaskId` is set, causing the terminal event to be ignored and the promise to never resolve.

**Suggested resolution (high-level)**
- Add a post-create reconciliation step (read child state or stream tail) and adopt a bounded wait policy (timeout or watchdog) with explicit semantics.

#### [R-2.2] “RuntimeManager auto-start race causes double subscriptions” — Mostly incorrect (as a race)

- **External bug ID**: 2.2
- **Code locations**:
  - Tool auto-start: [createSubtaskTool.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/tools/createSubtaskTool.ts#L153-L158)
  - Start guard: [runtimeManager.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtimeManager.ts#L97-L107)

**Review**
- `RuntimeManager.start()` has a synchronous guard (`if (this.#isRunning) return`) and does not `await`; two calls in the same process will not interleave inside `start()`.
- The underlying maintainability concern is still valid: a tool implicitly controls a global orchestrator lifecycle, but there is no “stop symmetry” or ownership boundary. This increases coupling and can create hard-to-debug background behavior in one-shot flows.

#### [R-2.3] “Cascade cancel race with child task completion” — Partially correct (semantic mismatch is real)

- **External bug ID**: 2.3
- **Code location**: [createSubtaskTool.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/tools/createSubtaskTool.ts#L271-L300)

**Review**
- The external writeup frames this as a TOCTOU between reading child status and canceling. While that can occur, the more important issue is semantic: when the parent receives an abort signal, it returns `Cancel` regardless of whether the child already completed successfully (because the terminal promise may be missed, or the child may complete during the abort handling).

**Suggested resolution (high-level)**
- On abort, perform a “last known child status” reconciliation and return the child’s terminal result if it already finished, otherwise proceed with best-effort cancel.

#### [R-2.4] “Subagent memory leak” — Missing details

- **External bug ID**: 2.4 is referenced in the matrix and taxonomy, but the document does not include a dedicated section describing the bug, location, or impact.
- If the intended issue is “subscription cleanup on timeout,” note that the current implementation has no timeout, and it does attempt cleanup in `finally` ([createSubtaskTool.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/tools/createSubtaskTool.ts#L298-L300)). The bigger leak risk today is an infinite wait due to missed terminal event, which retains a live subscription until abort/cancel.

### 2.3 User Interaction (UIP)

#### [R-3.1] “UIP response race with agent loop (double execution)” — Correct (mechanism simplified)

- **External bug ID**: 3.1
- **Code locations**:
  - `resume()` has no guard: [runtime.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtime.ts#L201-L218)
  - Multiple event handlers can overlap: [runtimeManager.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtimeManager.ts#L101-L106)

**Review**
- `execute()` and `resume()` do not enforce single-flight. If `RuntimeManager` overlaps event handling for the same `taskId` (e.g., a `TaskInstructionAdded` handler starts `execute()` while a `UserInteractionResponded` handler starts `resume()`), both can run concurrently.
- The external writeup’s “check then set race” narrative is not required; overlap arises because there is no shared serialized entry point.

#### [R-3.2] “UIP state machine desynchronization” — Partially correct (mostly an eventual-consistency concern)

- **External bug ID**: 3.2
- **Code locations**:
  - Task status projection: [taskService.ts](file:///Users/yangjerry/Repo/coauthor/src/application/taskService.ts#L227-L355)
  - Runtime flags: [runtime.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtime.ts#L313-L319)

**Review**
- There are multiple sources of truth for “paused/awaiting_user” (projection state) vs “in-flight agent loop” (runtime flags). Transient inconsistency is expected in event-sourced systems.
- This becomes a bug when decisions depend on the projection state without serialization or without validating the corresponding causal event (e.g., resuming based on a response that is not the pending interaction).

#### [R-3.3] “Double-resume hazard” — Correct (and ties to input validation)

- **External bug ID**: 3.3
- **Code locations**:
  - Resume handler: [runtimeManager.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtimeManager.ts#L173-L191)
  - Response append lacks pending-validation: [interactionService.ts](file:///Users/yangjerry/Repo/coauthor/src/application/interactionService.ts#L86-L104)

**Review**
- The system does not enforce “only the currently pending interaction can be responded to.” A stale or duplicated response event can trigger multiple resumes.
- Because `resume()` has no idempotency guard, these resumes can overlap and cause duplicate tool calls / event emission.

### 2.4 Review Summary

Overall assessment of the external analysis:
- The high-level risk themes are directionally correct (single-flight, missed events, input validation).
- Several specific TOCTOU scenarios are not feasible as written in single-threaded JS where the referenced code paths have no `await` between “check” and “set.”
- The most important actionable takeaway is still the same: enforce **per-task serialization** and make **subtask waits reconciliation-safe and bounded**.

## 3. Coupling Overview

At a high level, coupling is event-driven, but there are multiple asynchronous control planes:
- **Event plane**: `JsonlEventStore.append()` emits `StoredEvent` to subscribers via a hot observable ([jsonlEventStore.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/jsonlEventStore.ts#L113-L158)).
- **Routing plane**: `RuntimeManager.start()` subscribes and triggers async handling per event ([runtimeManager.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtimeManager.ts#L97-L107)).
- **Execution plane**: `AgentRuntime.execute()` / `resume()` runs the agent generator and emits domain events via `OutputHandler` ([runtime.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtime.ts#L168-L218), [outputHandler.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/outputHandler.ts#L81-L220)).
- **Interaction plane**: UIP responses are appended by `InteractionService` and routed back into runtimes ([interactionService.ts](file:///Users/yangjerry/Repo/coauthor/src/application/interactionService.ts#L56-L104), [runtimeManager.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtimeManager.ts#L173-L191)).
- **Subtask plane**: the subtask tool both creates a child task and subscribes to store events to wait for terminal status ([createSubtaskTool.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/tools/createSubtaskTool.ts#L175-L224)).

This architecture can be robust, but it requires explicit invariants (serialization, idempotency boundaries, and strict binding between approvals and actions). Without those invariants, subtle races become the dominant source of bugs.

## 4. Merged Findings (Canonical List)

Each finding below includes:
- **ID**: Unique reference code for tracking.
- **Category**: Bug / Security / Performance / Maintainability.
- **Location**: Exact file name(s) and line range(s).
- **Analysis**: Why this is a real problem, impact, and underlying technical reason.
- **Suggested Resolution (High-Level)**: 2–3 sentences, plus trade-offs and references.

### 4.1 Concurrency and Correctness

#### [CC-001] Event handling is not serialized per task (overlapping handlers)

- **Category**: Bug (Concurrency / Correctness)
- **Location**:
  - [runtimeManager.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtimeManager.ts#L97-L107) (lines 97–107)
  - [runtimeManager.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtimeManager.ts#L153-L248) (lines 153–248)

**Why this is a real problem**
- A task’s execution model implicitly assumes a single logical timeline (conversation history, pending tool calls, and lifecycle transitions).
- Without per-task serialization, multiple events targeting the same `taskId` can concurrently invoke `AgentRuntime` methods (`execute`, `resume`, `onInstruction`, `onResume`), producing timing-dependent behavior that cannot be reasoned about via event order alone.

**Impact**
- Duplicate lifecycle events (e.g., repeated `TaskStarted`) and non-deterministic side effects.
- Interleaved conversation writes and tool execution ordering.
- Increased frequency of pause/cancel races that surface as invalid transition exceptions.

**Underlying technical reason**
- The subscription starts async handlers without awaiting or sequencing. Promise completion order becomes detached from event emission order.

**Best practices / standards**
- In event-sourced systems, command handling and side effects are typically serialized per aggregate/stream to preserve determinism.
- Actor-style runtimes enforce “one mailbox, one processing loop” per actor/task.

**Suggested resolution (high-level)**
- Introduce per-task single-flight execution (queue or mutex) so that, for a given `taskId`, only one handler can call into its runtime at a time. Ensure resume, instruction handling, and lifecycle events are sequenced consistently with task status.

**Key considerations / trade-offs**
- Serialization improves determinism but can reduce throughput for “hot” tasks receiving many events.
- A queue-based design adds internal code complexity but reduces emergent complexity and debugging cost.

**References**
- Event sourcing aggregate processing guidance (per-stream sequential handling).
- Actor model mailbox semantics.

#### [CC-002] `AgentRuntime.execute()` and `resume()` can overlap (no single-flight guard)

- **Category**: Bug (Concurrency / Correctness)
- **Location**:
  - [runtime.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtime.ts#L168-L218) (lines 168–218)
  - [runtime.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtime.ts#L222-L242) (lines 222–242)

**Why this is a real problem**
- The runtime manages task-scoped scalar state (`#isExecuting`, `#abortController`, `#pendingInstructions`) and in-memory conversation arrays that assume single-threaded execution.
- Overlapping runs violate that assumption and can corrupt the logical pairing of assistant tool calls and tool results.

**Impact**
- Duplicate `TaskStarted` events and interleaved tool executions.
- Inconsistent conversation history as multiple loops append independently.
- Hard-to-reproduce failures due to timing sensitivity.

**Underlying technical reason**
- The runtime behaves like a non-reentrant actor, but the manager can call it concurrently.

**Best practices / standards**
- “Single-flight” (one in-flight operation per key) for stateful per-key runtimes.
- Avoid re-entrancy for components with mutable, per-invocation state.

**Suggested resolution (high-level)**
- Treat the runtime as non-reentrant: enforce a per-task execution lock either in `RuntimeManager` or within `AgentRuntime` itself, and coalesce repeated “run triggers” into a single queued continuation.

**Key considerations / trade-offs**
- Centralizing the lock in `RuntimeManager` simplifies global policy, but local runtime locking increases safety.
- Coalescing triggers requires clear definitions for instruction ordering and fairness.

#### [CC-003] Pause/cancel races can cause invalid transitions and abort in-flight execution

- **Category**: Bug (Concurrency / Correctness)
- **Location**:
  - [runtime.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtime.ts#L313-L354) (lines 313–354)
  - [taskService.ts](file:///Users/yangjerry/Repo/coauthor/src/application/taskService.ts#L202-L225) (lines 202–225)
  - [taskService.ts](file:///Users/yangjerry/Repo/coauthor/src/application/taskService.ts#L336-L355) (lines 336–355)

**Why this is a real problem**
- Pause/cancel are control-plane operations expected to behave predictably and safely.
- The runtime checks `canTransition(currentStatus, eventType)` at emission time; if status changes concurrently (e.g., to `paused`), the runtime may throw. Additionally, `TaskFailed` is not allowed from `paused`, removing a common recovery path ([taskService.ts](file:///Users/yangjerry/Repo/coauthor/src/application/taskService.ts#L214-L216)).

**Impact**
- Tasks can remain `paused` while the runtime aborts mid-flight.
- Partial tool execution and conversation writes may have already occurred.
- Debugging difficulty: failure depends on timing rather than deterministic logic.

**Underlying technical reason**
- This is a control-plane vs side-effect synchronization gap: cooperative interruption flags are not synchronized with strict state-machine enforcement.

**Best practices / standards**
- Ensure pause/cancel becomes visible only at safe points (serialized) or define “quiescent exit” semantics when state changes are detected.
- Avoid TOCTOU-like races between status reads and event emissions.

**Suggested resolution (high-level)**
- Define a clear policy for pause/cancel atomicity. Either make pause/cancel observable only at safe boundaries (via serialization) or allow the runtime to stop emitting further lifecycle events without throwing when it detects a concurrent state change.

**Key considerations / trade-offs**
- Stronger atomicity may reduce responsiveness.
- Allowing additional transitions (e.g., failing from paused) simplifies recovery but changes semantics.

#### [CC-004] `TaskInstructionAdded` is a universal wake-up that can implicitly unpause

- **Category**: Bug / Maintainability (Correctness semantics)
- **Location**:
  - [taskService.ts](file:///Users/yangjerry/Repo/coauthor/src/application/taskService.ts#L202-L205) (lines 202–205)
  - [taskService.ts](file:///Users/yangjerry/Repo/coauthor/src/application/taskService.ts#L356-L367) (lines 356–367)

**Why this is a real problem**
- Pause/cancel should be stable user-facing control states. If an instruction can implicitly transition a task back to `in_progress`, the system cannot reliably enforce “no work while paused.”

**Impact**
- Paused tasks can resume unexpectedly upon instruction arrival.
- Status checks that gate execution become unreliable in the presence of concurrent instruction events.

**Underlying technical reason**
- The projection reducer conflates “new work exists” with “permission to execute.”

**Best practices / standards**
- Separate “work pending” from “allowed to run” as distinct concerns.
- Prefer explicit resume semantics over implicit status flips.

**Suggested resolution (high-level)**
- Preserve `TaskInstructionAdded` as a work signal without forcing status to `in_progress` from `paused`/`canceled`. Require explicit resumption (or an explicitly documented policy) before execution resumes.

**Key considerations / trade-offs**
- Keeping current behavior is convenient but reduces controllability and safety.
- Introducing explicit gating improves safety but may require UI/UX adjustments.

#### [CC-005] Store emits events synchronously via a hot observable (re-entrancy amplification)

- **Category**: Bug Risk (Concurrency / Ordering semantics)
- **Location**:
  - [jsonlEventStore.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/jsonlEventStore.ts#L113-L158) (lines 113–158)

**Why this is a real problem**
- Even with monotonic event IDs, synchronous hot emission makes it easy to process event B (emitted during handling of event A) before all side effects of A’s async handler have completed.

**Impact**
- Increased difficulty reasoning about happens-before ordering.
- Higher likelihood of races in runtime lifecycle and projection reads.

**Underlying technical reason**
- Hot observables deliver synchronously by default; mixing that with async handlers without serialization detaches emission order from completion order.

**Best practices / standards**
- Make delivery order vs processing order explicit (serialize or schedule).
- Avoid deep re-entrancy unless the design is explicitly re-entrancy-safe.

**Suggested resolution (high-level)**
- Maintain monotonic event IDs, but ensure downstream processing is serialized per task/stream (or scheduled onto a controlled queue) so event emission order does not produce surprising processing interleavings.

**Key considerations / trade-offs**
- Scheduling adds latency but improves predictability.
- Per-task serialization typically yields most of the benefit without global serialization.

#### [CC-006] Instruction queueing/draining can bypass RuntimeManager drain logic

- **Category**: Bug (Concurrency / Correctness)
- **Location**:
  - [runtimeManager.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtimeManager.ts#L264-L270) (lines 264–270)
  - [runtime.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtime.ts#L86-L88) (lines 86–88)
  - [runtime.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtime.ts#L133-L158) (lines 133–158)
  - [conversationManager.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/conversationManager.ts#L166-L180) (lines 166–180)

**Why this is a real problem**
- RuntimeManager decides whether to re-execute based on `rt.hasPendingWork`, which only reflects `#pendingInstructions.length`.
- However, when idle and “safe,” `AgentRuntime.onInstruction()` directly appends the instruction to the conversation store and triggers execution, bypassing `#pendingInstructions`. Under concurrent delivery of multiple instruction events, this can lead to overlapping drain loops and duplicated executions even when `hasPendingWork` is false.

**Impact**
- Duplicate `TaskStarted` and repeated re-execution when multiple `TaskInstructionAdded` events arrive close together.
- Non-deterministic ordering of instruction injection relative to tool-result repair and UIP resumes.

**Underlying technical reason**
- Two different scheduling mechanisms exist (“pending instruction queue” vs “direct append + trigger execution”) without a single serialized coordinator, and `RuntimeManager`’s drain loop only accounts for one of them.

**Best practices / standards**
- Single scheduling source of truth for “work pending” and “should run now” decisions.
- Avoid mixing direct side effects and queued side effects without unified sequencing.

**Suggested resolution (high-level)**
- Choose a single instruction ingestion model (always queue and drain at safe points, or always inject via a serialized coordinator). Ensure the manager/runtime has one definitive “pending work” indicator that matches execution scheduling.

**Key considerations / trade-offs**
- Always-queue improves determinism but may reduce responsiveness for interactive “continue” style inputs.
- Always-inject is responsive but requires strict serialization to remain correct.

#### [CC-007] Manual execution path does not guard against in-flight execution

- **Category**: Bug (Concurrency / Correctness)
- **Location**:
  - [runtimeManager.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtimeManager.ts#L142-L149) (lines 142–149)
  - [runtime.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtime.ts#L168-L196) (lines 168–196)

**Why this is a real problem**
- `executeTask()` always calls `rt.execute()` without checking whether the runtime is already executing due to an event-driven trigger. This can overlap manual “agent run” with ongoing processing for the same task.

**Impact**
- Duplicate starts and interleaved tool execution and conversation writes.
- Timing-sensitive and non-repeatable outcomes when operators manually “poke” tasks.

**Underlying technical reason**
- Manual and event-driven scheduling share the same runtime instance but do not share a unified execution lock/queue.

**Best practices / standards**
- Ensure all execution entry points (manual run, auto-run on events, resume, instruction triggers) go through the same single-flight scheduler.

**Suggested resolution (high-level)**
- Route `executeTask()` through the same per-task serialization mechanism used for event-driven execution, and define clear behavior for “manual run while already running” (ignore, queue, or coalesce).

**Key considerations / trade-offs**
- Coalescing avoids redundant runs but may reduce operator “immediacy.”
- Queuing preserves intent but may require surfacing “queued” status in UI.

#### [CC-008] Drain loop and `execute()` share a clobbering `#isExecuting` flag (false-idle window)

- **Category**: Bug (Concurrency / Correctness)
- **Location**:
  - [runtime.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtime.ts#L168-L196) (lines 168–196)
  - [runtime.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtime.ts#L222-L242) (lines 222–242)

**Why this is a real problem**
- `#executeAndDrainQueuedInstructions()` sets `#isExecuting = true` and then calls `await this.execute()`. Inside `execute()`, the runtime sets `#isExecuting = true` and then resets it to `false` in `finally`.
- While the drain loop is still active, other triggers can observe `#isExecuting === false` and initiate additional execution (especially through entry points that do not check the flag).

**Impact**
- Increased likelihood of overlapping agent loops and duplicated tool calls.
- Hard-to-explain “why did it run twice” behavior during instruction bursts.

**Underlying technical reason**
- A single boolean is used as both (a) a re-entrancy guard and (b) an execution-state indicator across nested invocations, but nested invocations are not modeled explicitly.

**Suggested resolution (high-level)**
- Route `execute()`, `resume()`, and drain execution through a single per-task single-flight primitive. If a state flag is kept, make it non-clobbering (ref-counted) and ensure only the single-flight owner toggles it.

**Key considerations / trade-offs**
- A lock/queue eliminates these emergent states but requires clear “coalesce vs queue” semantics.

### 4.2 Reliability and Deadlocks

#### [RD-001] Subtask tool can hang due to a “missed terminal event” window

- **Category**: Bug (Reliability / Deadlock)
- **Location**:
  - [createSubtaskTool.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/tools/createSubtaskTool.ts#L175-L224) (lines 175–224)
  - [createSubtaskTool.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/tools/createSubtaskTool.ts#L182-L195) (lines 182–195)
  - [jsonlEventStore.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/jsonlEventStore.ts#L155-L157) (lines 155–157)

**Why this is a real problem**
- The tool ignores events until `childTaskId` is set (after `createTask()` resolves). Because event emission is synchronous, a fast child can reach a terminal state before filtering begins, leaving the parent waiting forever.

**Impact**
- Parent task blocks inside a tool call indefinitely (hard deadlock).
- Subscriptions and waiting promises can accumulate under repeated occurrences.

**Underlying technical reason**
- Time-of-check/time-of-use window between “subscribe” and “bind correlation key,” with no post-create reconciliation.

**Best practices / standards**
- Event-based waits should include a reconciliation path (read current state/stream tail) to prevent missed-event deadlocks.

**Suggested resolution (high-level)**
- After obtaining `childTaskId`, immediately perform a catch-up check (current task status or stream tail) before awaiting live events. Consider defining a timeout/watchdog policy suitable for task semantics.

**Key considerations / trade-offs**
- Catch-up reads add I/O but prevent deadlocks.
- Timeouts improve robustness but require clear “timeout outcome” semantics.

#### [RD-002] Pause does not abort in-flight tool waits (subtask pause deadlock)

- **Category**: Bug (Reliability / Control semantics)
- **Location**:
  - [runtime.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtime.ts#L92-L118) (lines 92–118)
  - [runtime.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtime.ts#L313-L319) (lines 313–319)
  - [createSubtaskTool.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/tools/createSubtaskTool.ts#L197-L206) (lines 197–206)

**Why this is a real problem**
- Pause is a control-plane signal expected to have bounded responsiveness.
- `onPause()` sets a boolean flag but does not abort the active AbortController; blocking tool calls are not yield points, so pause may never take effect.

**Impact**
- “Pause” appears ineffective for tasks currently blocked inside `create_subtask_*`.
- Operational recovery may require canceling or terminating the process.

**Underlying technical reason**
- Cooperative pause checks occur only between yields; blocked tool calls require abort propagation or bounded waits.

**Best practices / standards**
- Control-plane operations should be able to interrupt blocking waits where feasible, or the UI should represent pause as “pending until safe point.”

**Suggested resolution (high-level)**
- Define pause semantics explicitly: either abort in-flight tool waits on pause (and resume later) or ensure all blocking waits are bounded (timeouts) and pause is represented as “pending” until a safe boundary is reached.

**Key considerations / trade-offs**
- Aborting tools on pause improves responsiveness but requires robust resume semantics.
- Cooperative pause is simpler but must avoid unbounded blocking calls.

#### [RD-003] Canceled tasks can restart due to concurrent handling (cancel/restart corruption)

- **Category**: Bug (Reliability / Correctness)
- **Location**:
  - [runtimeManager.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtimeManager.ts#L156-L170) (lines 156–170)
  - [runtimeManager.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtimeManager.ts#L235-L242) (lines 235–242)
  - [taskService.ts](file:///Users/yangjerry/Repo/coauthor/src/application/taskService.ts#L217-L222) (lines 217–222)
  - [taskService.ts](file:///Users/yangjerry/Repo/coauthor/src/application/taskService.ts#L264-L272) (lines 264–272)

**Why this is a real problem**
- Cancellation should be monotonic unless an explicit restart intent exists. Allowing a canceled task to re-enter `in_progress` can trigger unintended work.

**Impact**
- Subtasks may report canceled to the parent tool but later appear done.
- Task histories become semantically confusing (“canceled then completed”).

**Underlying technical reason**
- Concurrent event handling plus permissive transitions (allowing `TaskStarted` from `canceled`) creates a race window where start/cancel interleave.

**Best practices / standards**
- Require explicit restart signals for reruns; avoid implicit restart via normal event flow.
- Serialize per-task handling to make cancel/start ordering deterministic.

**Suggested resolution (high-level)**
- Clarify whether “restart after cancel” is desired; if not, disallow `TaskStarted` from `canceled` (or gate it behind a distinct restart event). Independently, enforce per-task serialization so cancel cannot race with start.

**Key considerations / trade-offs**
- “Rerun” is often useful, but it should be explicit and auditable.
- Tightening transitions may require updates to CLI/TUI behavior.

#### [RD-004] Subtask tool starts RuntimeManager implicitly (no stop symmetry, potential lingering subscriptions)

- **Category**: Reliability / Maintainability
- **Location**:
  - [createSubtaskTool.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/tools/createSubtaskTool.ts#L153-L159) (lines 153–159)
  - [runtimeManager.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtimeManager.ts#L97-L130) (lines 97–130)

**Why this is a real problem**
- In one-shot execution modes, the subtask tool can start the RuntimeManager to ensure child tasks run, but it does not stop it afterward. This creates an implicit lifecycle coupling between a tool invocation and a global subscription-based orchestrator.

**Impact**
- RuntimeManager may keep running beyond the intended lifecycle of a single command, potentially processing unrelated future events in the same process.
- Harder test isolation: background subscriptions can outlive the initiating operation.

**Underlying technical reason**
- Lifecycle ownership is ambiguous: a tool invocation becomes responsible for starting a shared orchestrator, without a corresponding ownership boundary for shutdown.

**Best practices / standards**
- Shared orchestrators should have a single clear owner responsible for start/stop (e.g., app lifecycle).
- Avoid hidden global side effects within tool execution paths.

**Suggested resolution (high-level)**
- Make orchestrator lifecycle explicit: start/stop RuntimeManager at application boundaries rather than within tools, or introduce a scoped “ensure running” mechanism that includes a matching release/stop policy.

**Key considerations / trade-offs**
- For CLI one-shot flows, central orchestration simplifies ownership but may require rethinking how blocking waits are implemented.
- If tools remain responsible for “ensure running,” they need reference counting or an explicit “scope” contract.

### 4.3 Security and Authorization

#### [SA-001] Risky-tool approval is not bound to a specific tool call (authorization mismatch)

- **Category**: Security vulnerability (Authorization integrity)
- **Location**:
  - [runtime.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtime.ts#L266-L284) (lines 266–284)
  - [outputHandler.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/outputHandler.ts#L133-L171) (lines 133–171)
  - [toolExecutor.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/toolExecutor.ts#L106-L116) (lines 106–116)
  - [displayBuilder.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/displayBuilder.ts#L75-L86) (lines 75–86)

**Why this is a real problem**
- User confirmation is effectively an authorization capability. If it is not scoped to the exact action, the system can execute a risky operation the user did not intend to approve.

**Impact**
- Potential execution of unintended risky operations.
- Reduced trust in the UIP safety model and ambiguous auditing (approval → which tool?).

**Underlying technical reason**
- The approval token (`interactionId`) is not bound to `toolCallId` or a stable request hash; `ToolExecutor` only checks presence of `confirmedInteractionId`, not that it matches the action being executed.

**Best practices / standards**
- Principle of least privilege: approvals should be action-scoped.
- Avoid “confused deputy” patterns where an approval can be reused out of context.

**Suggested resolution (high-level)**
- Bind risky-tool confirmations to the specific tool call being approved (e.g., store `toolCallId` in the confirmation request and require an exact match before execution). Ensure audit logs can unambiguously connect approval → tool request → tool execution.

**Key considerations / trade-offs**
- Strong binding improves safety but may require UIP payload/schema adjustments.
- Agents may need to re-request confirmation when regenerating tool calls.

**References**
- Authorization best practice: least privilege and action-scoped capabilities.
- Confused deputy concept (indirect authorization mismatch).

#### [SA-002] UIP responses are not validated against the currently pending interaction before resuming

- **Category**: Security / Correctness (Control-flow integrity)
- **Location**:
  - [runtimeManager.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtimeManager.ts#L173-L191) (lines 173–191)
  - [interactionService.ts](file:///Users/yangjerry/Repo/coauthor/src/application/interactionService.ts#L86-L104) (lines 86–104)
  - [taskService.ts](file:///Users/yangjerry/Repo/coauthor/src/application/taskService.ts#L286-L300) (lines 286–300)

**Why this is a real problem**
- Stale or duplicated response events can resume the agent even when they do not correspond to the currently pending interaction. This weakens the UIP gate intended to ensure user-driven control.

**Impact**
- Unexpected resumes and confusing UI behavior (“already answered” still triggers work).
- Amplified risk when combined with risky-tool confirmation flows.
- Concurrency hazard: multiple resumes can overlap, causing duplicated tool calls and event emissions.

**Underlying technical reason**
- No single authoritative validation point ensures “responses must match current pending interaction,” and `resume()` itself does not enforce single-flight.

**Best practices / standards**
- Validate inputs at the service boundary.
- Treat UI events as untrusted until verified against current state.

**Suggested resolution (high-level)**
- Enforce that responses can only be appended for the task’s currently pending interaction, and route resume only when the interaction ID matches the pending ID. Define explicit behavior for late responses (reject, ignore, or log), and ensure resume execution is single-flight.

**Key considerations / trade-offs**
- Strict validation improves safety but may complicate event replay/testing unless replay mode is explicitly handled.

### 4.4 Performance and Resource Control

#### [PR-001] Cancellation is tool-dependent; `runCommand` ignores AbortSignal

- **Category**: Performance / Reliability (Resource control)
- **Location**:
  - [runCommand.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/tools/runCommand.ts#L35-L92) (lines 35–92)
  - [outputHandler.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/outputHandler.ts#L99-L109) (lines 99–109)

**Why this is a real problem**
- Canceled tasks can continue running resource-intensive commands. This affects system stability and can cause side effects after the user believes work has stopped.

**Impact**
- Continued side effects after cancellation.
- Potential resource exhaustion (CPU, disk, network) from runaway processes.

**Underlying technical reason**
- AbortController requires cooperative handling. The current `runCommand` implementation does not consult `ctx.signal` and does not use a cancellation-aware subprocess pattern.

**Best practices / standards**
- For long-running I/O, adopt abortable APIs or explicit kill/timeout mechanics.
- Standardize cancellation semantics across all tools.

**Suggested resolution (high-level)**
- Define minimum cancellation requirements for tools (early abort check, abort listener, termination of external work). For `runCommand`, ensure the underlying process can be terminated reliably when `ctx.signal` is aborted.

**Key considerations / trade-offs**
- Killing subprocesses can be platform-dependent and may leave partial side effects.
- Tighter cancellation may require improved audit semantics (“canceled mid-tool”).

#### [PR-003] Tool cancellation relies on voluntary cooperation (executor does not enforce AbortSignal)

- **Category**: Reliability / Performance (Resource control)
- **Location**:
  - [outputHandler.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/outputHandler.ts#L99-L109) (lines 99–109)
  - [toolExecutor.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/toolExecutor.ts#L63-L133) (lines 63–133)
  - [runtime.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtime.ts#L115-L118) (lines 115–118)

**Why this is a real problem**
- Abort/cancel behavior is inconsistent across tools because the executor does not enforce cancellation. If a tool ignores the signal, cancellation cannot preempt it, and side effects can continue after the task is canceled.

**Impact**
- Uneven operational guarantees: some tools stop quickly (those that listen to AbortSignal), while others run to completion.
- Increased risk of runaway or “zombie” work continuing after cancel.

**Underlying technical reason**
- AbortSignal is a cooperative mechanism; without enforcement or a standard contract, cancellation becomes an implementation detail of each tool rather than a system guarantee.

**Best practices / standards**
- Define a tool execution contract for cancellation (minimum requirements for every tool).
- Where possible, wrap tool execution in a cancellation-aware layer that can stop external work reliably.

**Suggested resolution (high-level)**
- Establish a consistent cancellation contract for all tools and enforce it via testable invariants (e.g., tools must check `ctx.signal` early and attach abort listeners). For tools that cannot be safely aborted, explicitly document their behavior and add UI warnings.

**Key considerations / trade-offs**
- Enforcing cancellation may require additional complexity for tools that spawn external processes.
- Some operations may be unsafe to abort mid-flight; in those cases, cancellation semantics should be “best effort” and clearly communicated.

#### [PR-002] Subtask depth computation can be expensive and can loop on cycles

- **Category**: Performance bottleneck / Reliability
- **Location**:
  - [createSubtaskTool.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/tools/createSubtaskTool.ts#L55-L66) (lines 55–66)
  - [taskService.ts](file:///Users/yangjerry/Repo/coauthor/src/application/taskService.ts#L93-L107) (lines 93–107)

**Why this is a real problem**
- `computeDepth()` repeatedly calls `getTask()`, which rebuilds the full tasks projection each time. A malformed parent chain can also create an infinite loop.

**Impact**
- Increased latency when spawning subtasks.
- CPU overhead from repeated full projections.
- Potential infinite loop on cyclic parent chains.

**Underlying technical reason**
- O(depth × projectionCost) behavior with no cycle detection.

**Best practices / standards**
- Avoid repeated full projections in a hot path.
- Add cycle detection or maximum steps for graph walks.

**Suggested resolution (high-level)**
- Add a bounded-depth/cycle guard and avoid repeated projection rebuilds (cache within the call, or provide a more direct lookup). Consider projecting and storing depth explicitly if nesting is a first-class feature.

**Key considerations / trade-offs**
- Caching improves speed but must remain consistent with event sourcing expectations.
- Storing depth denormalizes state but can be maintained deterministically via projection.

### 4.5 Documentation and Consistency Gaps

#### [DC-001] “Single-subscriber” assumption is violated by subtask tool subscriptions

- **Category**: Maintainability / Design consistency
- **Location**:
  - [runtimeManager.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtimeManager.ts#L97-L107) (lines 97–107)
  - [createSubtaskTool.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/tools/createSubtaskTool.ts#L182-L207) (lines 182–207)

**Why this is a real problem**
- If developers believe there is a single subscriber to `events$`, they may introduce changes relying on that invariant. In reality, tool-level subscriptions add additional observers and can affect ordering and resource assumptions.

**Impact**
- Increased mental load when reasoning about event flow.
- Potential subscription leaks under hangs or long waits.

**Underlying technical reason**
- Subscribing in tools introduces an additional control plane competing with orchestration for event visibility.

**Suggested resolution (high-level)**
- Either explicitly document and constrain “tools may subscribe” (timeouts, cleanup guarantees), or route subtask waiting through an orchestrator abstraction rather than direct subscription from tools.

**Key considerations / trade-offs**
- Centralizing subscriptions simplifies reasoning but adds orchestration surface area.
- Allowing tool subscriptions is flexible but needs strict cleanup and reliability guarantees.

#### [DC-002] Comment states pause propagation via AbortSignal but runtime only aborts on cancel

- **Category**: Maintainability / Correctness documentation
- **Location**:
  - [createSubtaskTool.ts](file:///Users/yangjerry/Repo/coauthor/src/infra/tools/createSubtaskTool.ts#L10-L12) (lines 10–12)
  - [runtime.ts](file:///Users/yangjerry/Repo/coauthor/src/agents/runtime.ts#L92-L118) (lines 92–118)

**Why this is a real problem**
- In concurrent systems, inaccurate documentation drives incorrect assumptions and can cause debugging and operational decisions to be wrong (e.g., assuming pause will interrupt a blocking wait).

**Impact**
- Misdiagnosis of “pause stuck” incidents.
- Higher risk of regressions due to mismatched expectations.

**Underlying technical reason**
- Pause is implemented as a cooperative flag; AbortSignal is used only for cancel.

**Suggested resolution (high-level)**
- Align behavior and documentation: either document pause as “at safe points only,” or extend pause to abort blocking tool calls if that is desired semantics.

**Key considerations / trade-offs**
- “Pause = abort” is responsive but requires careful resume behavior.
- “Pause = cooperative” is simpler but must ensure no unbounded blocking calls.

## 5. Recommended Priorities (Non-Implementation)

1. **Per-task serialization**: enforce single-flight semantics per `taskId` to eliminate most timing-dependent failures.
2. **Runtime single-flight**: route `execute()`, `resume()`, and drain execution through one serialized entry point.
3. **Approval binding**: bind risky-tool confirmations to a specific tool call to protect authorization integrity.
4. **Subtask wait hardening**: add terminal-state catch-up checks and define timeouts/cleanup policies.
5. **Pause/cancel semantics**: unify control-plane behavior with the state machine so pause/cancel cannot induce invalid transitions.
6. **Tool cancellation standardization**: ensure long-running tools implement consistent cooperative cancellation.
7. **Document invariants**: explicitly document subscription model and control semantics to prevent future regressions.

## Appendix A. Cross-Reference: Bug IDs vs Finding IDs

- External 1.1 → [CC-008](#cc-008-drain-loop-and-execute-share-a-clobbering-isexecuting-flag-false-idle-window) (plus overlaps with [CC-002](#cc-002-agentruntimeexecute-and-resume-can-overlap-no-single-flight-guard))
- External 1.2 → No canonical finding (external scenario incorrect as stated)
- External 1.3 → No canonical finding (external scenario incorrect as stated)
- External 2.1 → [RD-001](#rd-001-subtask-tool-can-hang-due-to-a-missed-terminal-event-window)
- External 2.2 → [RD-004](#rd-004-subtask-tool-starts-runtimemanager-implicitly-no-stop-symmetry-potential-lingering-subscriptions) (lifecycle coupling, not a race)
- External 2.3 → [RD-001](#rd-001-subtask-tool-can-hang-due-to-a-missed-terminal-event-window) (missed-event) + semantic mismatch under abort
- External 3.1 → [CC-002](#cc-002-agentruntimeexecute-and-resume-can-overlap-no-single-flight-guard)
- External 3.2 → [CC-003](#cc-003-pausecancel-races-can-cause-invalid-transitions-and-abort-in-flight-execution) + [SA-002](#sa-002-uip-responses-are-not-validated-against-the-currently-pending-interaction-before-resuming)
- External 3.3 → [SA-002](#sa-002-uip-responses-are-not-validated-against-the-currently-pending-interaction-before-resuming)
- External 2.4 → Not documented in external file; see [RD-001](#rd-001-subtask-tool-can-hang-due-to-a-missed-terminal-event-window) for current leak-like behavior via infinite wait

## Appendix B. Race Taxonomy (Practical)

- **Single-flight violation**: multiple “start work” triggers for the same task proceed concurrently (missing per-task serialization).
- **Missed-event deadlock**: an event-based wait filters out the only terminal event and then waits forever.
- **Control-plane vs side-effect gap**: pause/cancel changes state while side effects are in-flight, creating invalid transitions or post-cancel work.
- **Confused deputy / approval mismatch**: a confirmation is treated as a general capability rather than a specific action authorization.
