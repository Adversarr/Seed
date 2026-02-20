# Seed vs Linux-like OS: Feature Comparison

This document compares Seed's current capabilities with a Linux-like operating system, identifying missing core features and providing implementation guidance.

## Overview

Seed is designed as a goal-driven local AI assistant system with task orchestration capabilities. When viewed through the lens of an operating system:

| OS Concept | Seed Equivalent | Location |
|-----------|-----------------|-----------|
| **Process** | Task | `src/core/entities/task.ts` |
| **Process Tree** | Parent/Child Tasks | `taskService.ts` with `parentTaskId`, `childTaskIds` |
| **Priority Scheduling** | `TaskPriority` (foreground/normal/background) | `task.ts` |
| **Process State** | Task state machine (open/in_progress/awaiting_user/paused/done/failed/canceled) | `taskService.ts` |
| **Filesystem** | ArtifactStore + Workspace | `fsArtifactStore.ts`, `workspace/` |
| **Terminal/Output** | Conversation + OutputHandler | `conversationManager.ts`, `outputHandler.ts` |
| **System Calls** | Tools (readFile, runCommand, etc.) | `tools/` directory |
| **Extensions** | MCP Servers | `mcpClient.ts` |
| **Packages** | Skills | `skills/` directory |
| **Audit Log** | AuditLog | `jsonlAuditLog.ts` |
| **User Interaction (UIP)** | InteractionService | `interactionService.ts` |
| **Scheduler** | RuntimeManager | `runtimeManager.ts` |
| **Multiprocessing** | Concurrent task scheduling within single process | `AsyncMutex` serialization |

---

## Existing Features

### Task Management
- **Task Lifecycle**: Create, start, pause, resume, cancel, complete, fail
- **Task Priorities**: foreground, normal, background
- **Task Groups**: Parent-child relationships with depth limits
- **Task Instructions**: Add instructions to running tasks
- **Todo Tracking**: Per-task todo list management

### Storage & Persistence
- **Event Store**: JSONL-based event sourcing
- **Audit Log**: Tool call tracing with configurable limits
- **Conversation Store**: LLM context persistence
- **Artifact Store**: Filesystem access with path validation

### Tool System
- **Built-in Tools**: readFile, editFile, listFiles, runCommand, glob, grep, webSearch, webFetch
- **MCP Integration**: Dynamic tool discovery from MCP servers
- **Tool Execution**: With audit logging and risk assessment
- **Tool Registry**: Centralized tool management

### Agent System
- **Multiple Agents**: Coordinator, Research, Chat
- **Agent Runtime**: Per-task execution context
- **Conversation Management**: LLM conversation handling
- **Output Handling**: Tool result processing

### Configuration
- **LLM Profiles**: Multiple LLM configurations
- **MCP Profiles**: MCP server configurations
- **Resource Limits**: Max output length, audit log limits
- **Timeouts**: Interaction timeout, execution timeout

---

## Missing Core Features

### 1. CRON / Scheduled Tasks ⭐️ **Highest Priority**

**Status**: Not implemented

**Required Capabilities**:
- Cron expression parser
- Scheduled task registration/management
- Automatic task triggering on schedule
- Task execution history
- Schedule conflict detection

**Implementation Path**:
```
src/infrastructure/scheduling/
  ├── cronScheduler.ts      # Main scheduler
  ├── cronParser.ts         # Cron expression parser
  └── scheduledTaskStore.ts # Persistence for scheduled tasks
```

**New Event Types**:
- `ScheduledTaskCreated`
- `ScheduledTaskTriggered`
- `ScheduledTaskFailed`
- `ScheduledTaskDisabled`

**HTTP API Endpoints**:
- `GET /api/scheduled-tasks` - List scheduled tasks
- `POST /api/scheduled-tasks` - Create scheduled task
- `PUT /api/scheduled-tasks/:id` - Update scheduled task
- `DELETE /api/scheduled-tasks/:id` - Delete scheduled task
- `POST /api/scheduled-tasks/:id/enable` - Enable task
- `POST /api/scheduled-tasks/:id/disable` - Disable task

**Example Cron Expression Support**:
```
* * * * *  # Every minute
0 * * * *  # Every hour
0 0 * * *  # Every day at midnight
0 9 * * 1-5  # Every weekday at 9 AM
*/5 * * * *  # Every 5 minutes
```

---

### 2. Process Resource Management / Quotas

**Status**: Minimal (only `maxOutputLength`)

**Required Capabilities**:
- Task-level CPU limits
- Task-level memory limits
- Concurrent task limits
- Resource usage statistics/monitoring
- Resource-based task throttling

**Implementation Path**:
```
src/infrastructure/resources/
  ├── resourceMonitor.ts    # Track resource usage
  ├── resourceQuota.ts      # Enforce quotas
  └── resourceStats.ts      # Collect statistics
```

**Configuration Extensions**:
```typescript
resources: {
  auditLogLimit: number
  maxOutputLength: number
  maxConcurrentTasks: number      // NEW
  maxCpuUsage: number           // NEW (percentage)
  maxMemoryUsage: number         // NEW (MB)
  taskTimeout: number            // NEW (seconds)
}
```

---

### 3. Background Tasks (Daemon)

**Status**: Tasks terminate after completion, no persistent background concept

**Required Capabilities**:
- `daemon` task type
- Task keep-alive mechanism
- Auto-restart on failure
- Health checks for daemons
- Daemon lifecycle management

**Implementation Path**:
```
src/core/entities/task.ts
  // Add task type: 'one-time' | 'daemon'

src/infrastructure/daemons/
  ├── daemonManager.ts       # Manage daemon tasks
  ├── healthChecker.ts      # Health check monitoring
  └── restartPolicy.ts     # Restart strategies
```

**New Event Types**:
- `DaemonStarted`
- `DaemonStopped`
- `DaemonRestarted`
- `DaemonHealthCheckFailed`

---

## Priority Recommendations

| Priority | Feature | Rationale |
|----------|----------|------------|
| **P0** | **CRON / Scheduled Tasks** | Explicitly requested, most common automation need |
| **P1** | Task Resource Monitoring | Essential for understanding system health |
| **P2** | Background Tasks (Daemon) | Needed for long-running services |

---

## Extension Points in Current Architecture

The following are existing integration points where new features can be added:

### 1. CRON Scheduler
**Integration Point**: Can be an independent service that triggers tasks via `eventStore.append()`

```typescript
// In cronScheduler.ts
async triggerScheduledTask(taskId: string) {
  await eventStore.append(taskId, [{
    type: 'TaskCreated',
    payload: { /* ... */ }
  }])
}
```

### 2. Resource Monitoring
**Integration Point**: Hook into `toolExecutor.ts` and `AgentRuntime`

```typescript
// In toolExecutor.ts
async execute(call: ToolCallRequest, ctx: ToolContext) {
  const startTime = Date.now()
  const startMemory = process.memoryUsage().heapUsed

  // ... existing execution logic ...

  const duration = Date.now() - startTime
  const memoryDelta = process.memoryUsage().heapUsed - startMemory
  resourceMonitor.recordUsage(ctx.taskId, { duration, memoryDelta })
}
```

### 3. Background Tasks
**Integration Point**: Extend `RuntimeManager` to handle daemon lifecycle

```typescript
// In RuntimeManager
async #handleEvent(event: StoredEvent): Promise<void> {
  if (event.type === 'DaemonStarted') {
    const rt = this.#getOrCreateRuntime(taskId, agentId)
    rt.setDaemonMode(true)
    await this.#executeAndDrain(rt, taskId)
  }
}
```

---

## Implementation Roadmap

### Phase 1: CRON Scheduler (P0)
1. Implement cron expression parser
2. Create scheduled task store
3. Implement scheduler service
4. Add HTTP API endpoints
5. Add Web UI for managing scheduled tasks
6. Write tests

### Phase 2: Resource Monitoring (P1)
1. Implement resource collector
2. Add metrics aggregation
3. Create metrics API
4. Add monitoring dashboard to Web UI
5. Write tests

### Phase 3: Background Tasks (P2)
1. Add daemon task type
2. Implement daemon manager
3. Add health checking
4. Implement restart policies
5. Add daemon management UI
6. Write tests

## References

- [Cron Expression Format](https://en.wikipedia.org/wiki/Cron)
- [Linux Process Management](https://man7.org/linux/man-pages/man7/signal.7.html)
- [Resource Monitoring Best Practices](https://www.kernel.org/doc/html/latest/accounting/)
- [Event Sourcing Patterns](https://martinfowler.com/eaaDev/EventSourcing.html)
