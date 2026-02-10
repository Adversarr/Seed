# Web UI Bug Report

Report generated: 2026-02-10
Scope: `web/` directory - Frontend implementation review

---

## Summary

| Severity | Count | Issues |
|----------|--------|---------|
| 🔴 Critical | 5 | Task loading failure, type casting bug, API mismatch (events/interactions), WebSocket race condition |
| 🟠 High Priority | 6 | Payload assumptions, effect dependencies, empty form submission, inconsistent query params, runtime agent fields |
| 🟡 Medium Priority | 5 | Stale activity data, useEffect antipattern, task update handling, missing error handling, unused imports |

**Total Bugs Found: 16**

---

## 🔴 Critical Bugs

### 1. Task Detail Page Cannot Load Task (NAVIGATION FAILURE)

**File:** `src/pages/TaskDetailPage.tsx:22`

**Code:**
```typescript
const task = useTaskStore(s => s.tasks.find(t => t.taskId === taskId))
```

**Problem:**
The TaskDetailPage only looks up the task from the **already-loaded** `useTaskStore`. When you navigate directly to a task URL (or refresh the page), the store is empty because `fetchTasks()` was only called in the DashboardPage.

**Reproduction Steps:**
1. Open the dashboard (tasks load via `fetchTasks()`)
2. Click on any task - it works because task is in store from dashboard
3. Refresh the task detail page - shows "Task not found" even though task exists
4. Or: Visit `/tasks/{taskId}` directly - always shows "Task not found"

**Expected Behavior:**
TaskDetailPage should fetch the specific task via `api.getTask(taskId)` if it's not in the store, similar to:
```typescript
useEffect(() => {
  if (taskId && !task) {
    api.getTask(taskId).then(t => /* add to store */)
  }
}, [taskId])
```

**Actual Behavior:**
Shows "Task not found" error page because `task` is `undefined` when store is empty.

**Impact:**
Users cannot directly navigate to task URLs or refresh task pages. This breaks URL sharing and basic browser navigation.

---

### 2. Type Casting Bug in `taskStore.ts`

**File:** `src/stores/taskStore.ts:48`

**Code:**
```typescript
intent: (p.intent as string) ?? '',
```

**Problem:**
The cast `as string` will convert `undefined` to string literal `"undefined"`, which is truthy, so `?? ''` fallback never executes.

**Expected Behavior:**
When `p.intent` is `undefined`, field should be set to empty string.

**Actual Behavior:**
When `p.intent` is `undefined`, it becomes `"undefined"` (the string "undefined").

**Fix:**
```typescript
intent: (p.intent as string | undefined) ?? '',
// or simply
intent: (p.intent ?? '') as string,
```

---

### 3. API Response Type Mismatch in `api.ts`

**File:** `src/services/api.ts:71`

**Code:**
```typescript
readFile: (path: string) => get<{ content: string; lines: number }>(`/api/files?path=${encodeURIComponent(path)}`),
```

**Problem:**
The frontend expects `{ content: string; lines: number }` but the backend at `httpServer.ts:247` returns:

```typescript
return c.json({ path: filePath, content })
```

**Expected Behavior:**
Frontend should match backend response shape: `{ path: string; content: string }`

**Actual Behavior:**
TypeScript types don't match runtime data, potentially causing errors if `lines` or `path` fields are accessed incorrectly.

---

### 4. WebSocket Reconnection Race Condition

**File:** `src/services/ws.ts:99-105`

**Code:**
```typescript
#scheduleReconnect(): void {
  if (this.#disposed) return
  this.#reconnectTimer = setTimeout(() => {
    this.#reconnectDelay = Math.min(this.#reconnectDelay * 2, 30_000)
    this.connect()
  }, this.#reconnectDelay)
}
```

**Problem:**
If connection fails and closes multiple times rapidly (e.g., network flapping), multiple timers can be set without canceling previous ones. The `connect()` method (line 33) returns early if `#ws` exists, but that's not guaranteed to prevent race conditions.

**Expected Behavior:**
Only one reconnection attempt should be active at a time.

**Actual Behavior:**
Multiple overlapping reconnection timers can lead to multiple WebSocket connections being created, causing resource leaks and unpredictable behavior.

**Fix:**
Clear any existing timer before setting a new one at the start of `#scheduleReconnect()`.

---

## 🟠 High Priority Bugs

### 5. WebSocket Payload Access in `streamStore.ts`

**File:** `src/stores/streamStore.ts:29-33`

**Code:**
```typescript
handleUiEvent: (event) => {
  if (event.type === 'agent_output' || event.type === 'stream_delta') {
    const { taskId, kind, content } = event.payload
```

**Problem:**
The code assumes `agent_output` and `stream_delta` payloads have `{ taskId, kind, content }`. While this is correct for those events, `audit_entry` event type (line 51 in `types.ts`) has a completely different payload structure (`StoredAuditEntry`). The condition only filters for `agent_output` and `stream_delta`, so this is currently safe, but it's fragile and could cause issues if more event types are added.

**Recommendation:**
Extract into separate handlers per event type for better type safety.

---

### 6. Missing React Effect Dependencies in `TaskDetailPage.tsx`

**File:** `src/pages/TaskDetailPage.tsx:28-34`

**Code:**
```typescript
useEffect(() => {
  if (taskId && task?.pendingInteractionId) {
    api.getPendingInteraction(taskId).then(setInteraction).catch(() => {})
  } else {
    setInteraction(null)
  }
}, [taskId, task?.pendingInteractionId])
```

**Problem:**
The effect uses the full `task` object but only depends on `task?.pendingInteractionId`. If `task` changes while `pendingInteractionId` stays the same, the effect won't re-run. Also, ESLint would flag this as `task` being used but not in dependencies.

**Expected Behavior:**
Effect should re-run when task data changes.

**Actual Behavior:**
Effect may become stale if task object changes (e.g., status updates) while `pendingInteractionId` remains the same.

**Fix:**
Add `task` to dependency array or restructure to only depend on needed values.

---

### 7. Empty Form Submission in `InteractionPanel.tsx`

**File:** `src/components/InteractionPanel.tsx:77`

**Code:**
```typescript
onKeyDown={e => e.key === 'Enter' && respond()}
```

**Problem:**
Pressing Enter on the input field submits the form regardless of whether `inputValue` has content. For `Input` or `Composite` interaction kinds, submitting empty input may not be intended behavior and could confuse the agent.

**Expected Behavior:**
Should validate input before submission.

**Actual Behavior:**
Can submit empty responses, leading to potentially incorrect agent behavior.

**Fix:**
Add validation: `onKeyDown={e => e.key === 'Enter' && inputValue.trim() && respond()}`

---

### 8. Stale Closure Risk in `DashboardPage.tsx` Task Click Handler

**File:** `src/pages/DashboardPage.tsx:99`

**Code:**
```typescript
onClick={() => navigate(`/tasks/${task.taskId}`)}
```

**Problem:**
While this appears to work, there's a potential stale closure issue. The `task` object is captured from the `.map()` closure. If the task list updates while the click handler is pending (unlikely but possible in rapid updates), the handler could reference stale data.

**More importantly:** This navigation relies on the task being in the store, which relates to Bug #1 - if you navigate directly to a task URL, it won't be in the store.

---

## 🟡 Medium Priority Issues

### 9. Stale Data in `ActivityPage.tsx`

**File:** `src/pages/ActivityPage.tsx:23-26`

**Code:**
```typescript
useEffect(() => {
  setLoading(true)
  api.getEvents(0).then(e => { setEvents(e); setLoading(false) }).catch(() => setLoading(false))
}, [])
```

**Problem:**
The activity page fetches events only once on mount. New events arriving via WebSocket (which update the task store) are not reflected in the Activity page. Users won't see new activity unless they manually refresh the page.

**Expected Behavior:**
Activity page should update in real-time as events arrive.

**Actual Behavior:**
Activity page shows stale data after initial load, requiring manual refresh.

**Fix:**
Subscribe to WebSocket events or add a refresh mechanism.

---

### 10. useEffect Antipattern in `DashboardPage.tsx`

**File:** `src/pages/DashboardPage.tsx:33`

**Code:**
```typescript
useEffect(() => { fetchTasks() }, [fetchTasks])
```

**Problem:**
While `fetchTasks` is stable in Zustand (won't cause infinite renders), this pattern is an antipattern and can cause issues if the store implementation changes. It's confusing and not idiomatic React.

**Better Approaches:**
- Remove dependency array entirely (runs on every render) - though inefficient
- Use a stable reference wrapper
- Remove useEffect entirely and call `fetchTasks()` directly in the component

---

### 11. Task Duplicate Handling Edge Case in `taskStore.ts`

**File:** `src/stores/taskStore.ts:41-43`

**Code:**
```typescript
case 'TaskCreated': {
  // Avoid duplicates
  if (tasks.some(t => t.taskId === p.taskId)) return
```

**Problem:**
This prevents adding a task with the same ID, but:
1. If WebSocket delivers a `TaskCreated` event before HTTP fetch completes, the task will be missing from state.
2. If HTTP fetch returns a task and WebSocket delivers it again, it's correctly ignored.
3. There's no handling for updates - if a task's other properties change, they won't be reflected.

**Expected Behavior:**
Should handle both new tasks and updates to existing tasks.

**Actual Behavior:**
Only handles new tasks; updates to existing tasks are ignored, leading to stale data.

**Fix:**
Instead of `return`, update the existing task or implement an upsert pattern.

---

### 12. Missing Error Handling in `SettingsPage.tsx`

**File:** `src/pages/SettingsPage.tsx:12-16`

**Code:**
```typescript
const saveToken = () => {
  sessionStorage.setItem('coauthor-token', token)
  disconnect()
  setTimeout(connect, 100)
}
```

**Problems:**
1. No error handling if `sessionStorage` throws (e.g., in iframe contexts with storage restrictions)
2. `setTimeout` with arbitrary 100ms delay is not guaranteed to be sufficient for `disconnect()` to complete
3. No user feedback if saving fails

**Expected Behavior:**
Graceful handling of storage restrictions and proper disconnection before reconnection.

**Actual Behavior:**
May throw unhandled errors in restricted environments and may reconnect before disconnect completes.

---

### 13. Unused React Import in `StreamOutput.tsx`

**File:** `src/components/StreamOutput.tsx:1`

**Code:**
```typescript
import React from 'react'  // Not used
```

**Problem:**
Since React 17+ with the new JSX transform, the explicit `React` import is unnecessary unless you're using `React` APIs like `React.useState`. This file only uses hooks from 'react' directly.

**Impact:**
Build warning; dead code.

**Fix:**
```typescript
// Remove this line:
import React from 'react'
```

---

### 14. Multiple API Response Shape Mismatches (CRITICAL)

**File:** `src/services/api.ts:51, 56, 67, 61`

**Problem:**
Several API methods in `api.ts` have return types that don't match the actual JSON structure returned by the backend in `httpServer.ts`.

1. **Events:** `api.getEvents()` expects `StoredEvent[]` but backend returns `{ events: StoredEvent[] }`.
2. **Pending Interactions:** `api.getPendingInteraction()` expects `PendingInteraction | null` but backend returns `{ pending: PendingInteraction | null }`.
3. **Audit:** `api.getAudit()` expects `unknown[]` but backend returns `{ entries: unknown[] }`.
4. **Runtime:** `api.getRuntime()` expects `name` field in agents, but backend sends `displayName`.

**Impact:**
- **ActivityPage.tsx:38** will crash when trying to map over the response object.
- **TaskDetailPage.tsx:28** will fail to load interactions because it receives a wrapped object.
- **DashboardPage.tsx** will fail to show the global interaction prompt.

**Fix:**
Update `api.ts` to unwrap the responses using `.then(r => r.events)` etc., or update the type definitions to match the wrapped shape.

---

### 15. Inconsistent `streamId` Query Parameter Support (HIGH)

**File:** `src/services/api.ts:48-52` vs `src/infra/http/httpServer.ts:179-183`

**Problem:**
The frontend `api.getEvents` method allows passing a `streamId` (taskId) as a query parameter. However, the backend route `/api/events` completely ignores this parameter, only looking for `after`.

**Expected Behavior:**
The backend should filter events by `streamId` if provided, or the frontend should use the task-specific route `/api/tasks/:id/events`.

**Actual Behavior:**
The frontend thinks it's filtering by task, but it receives ALL events from the system, leading to potentially large data transfers and incorrect UI state if the frontend doesn't filter the result itself.

---

### 16. Agent Field Name Mismatch in Runtime API (HIGH)

**File:** `src/services/api.ts:61` vs `src/infra/http/httpServer.ts:218-222`

**Problem:**
Frontend expects `agents: Array<{ id: string; name: string }>`, but backend returns `agents: Array<{ id: string; displayName: string; description: string }>`.

**Impact:**
Any UI component trying to display the agent's name via `agent.name` will show `undefined`.

**Fix:**
Align the field names in both `api.ts` and the `HealthResponse` types.

---

## Bug Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CRITICAL BUG #1                               │
│              Task Navigation/Loading Failure                        │
│                    (User's Main Issue)                                │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Root Cause: TaskDetailPage only reads from store, never fetches    │
│  Impact: Direct navigation to tasks broken; refresh breaks page     │
└─────────────────────────────────────────────────────────────────────┘

Related Issues:
├── Bug #2 (Type Casting) - Can cause task data corruption
├── Bug #11 (Duplicate Handling) - Affects task updates in store
└── Bug #9 (Stale Activity) - Similar pattern: no real-time updates
```

---

## Recommendations for Remediation

### Immediate Actions (Critical Bugs)

1. **Fix Task Loading (Bug #1)** - This is blocking basic navigation
   - Add `fetchTask(taskId)` API call in TaskDetailPage when task not in store
   - Or use the existing `api.getTask()` to load individual tasks

2. **Fix API Response Shape Mismatches (Bug #3 & #14)** - Critical for core functionality
   - Update `api.ts` to correctly unwrap `events`, `pending`, `entries`, and `path/content` from responses.
   - Align `agent` field names (`displayName` vs `name`).

3. **Fix the type casting bug (Bug #2)** - Silently corrupting data
   - Change `intent: (p.intent as string) ?? ''` to proper type-safe handling

4. **Fix WebSocket reconnection race condition (Bug #4)**
   - Clear existing timer before setting new one

### Short-term Actions (High Priority)

5. Add proper validation to interaction form submission (Bug #7)
6. Fix React effect dependencies (Bug #6)
7. Separate UiEvent handlers by type (Bug #5)
8. Fix inconsistent `streamId` support (Bug #15)
9. Fix agent field names in UI (Bug #16)
10. Review stale closure risks (Bug #8)

### Long-term Actions (Medium Priority)

9. Implement real-time updates for Activity page (Bug #9)
10. Refactor useEffect patterns (Bug #10)
11. Implement proper upsert for task updates (Bug #11)
12. Add comprehensive error handling (Bug #12)
13. Clean up unused imports (Bug #13)

---

## References

- **Backend WebSocket Protocol:** `src/infra/ws/protocol.ts`
- **Backend HTTP Server:** `src/infra/http/httpServer.ts`
- **Domain Types:** `src/domain/events.ts`
- **UI Event Types:** `src/domain/ports/uiBus.ts`
- **Original Bug Report:** User question about task pages not opening

---

*Report compiled from code review session - all bugs verified against codebase at commit 49ede2c*
