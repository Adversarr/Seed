# Web UI Bug Report

Report generated: 2026-02-10
Last updated: 2026-02-11 (Added status verification)
Scope: `web/` directory - Frontend implementation review

---

## Summary

| Severity | Count | Fixed | Still Present | Issues |
|----------|-------|-------|---------------|---------|
| 🔴 Critical | 5 | 5 | 0 | Task loading failure, type casting bug, API mismatch (events/interactions), WebSocket race condition |
| 🟠 High Priority | 6 | 2 | 4 | Payload assumptions, effect dependencies, empty form submission, inconsistent query params, runtime agent fields |
| 🟡 Medium Priority | 5 | 4 | 1 | Stale activity data, useEffect antipattern, task update handling, missing error handling, unused imports |

**Total Bugs Found: 16 | Fixed: 11 (69%) | Still Present: 5 (31%)**

---

## 🔴 Critical Bugs

### 1. Task Detail Page Cannot Load Task (NAVIGATION FAILURE)

**Status: ✅ FIXED**

**File:** `src/pages/TaskDetailPage.tsx:22`

**Code:**
```typescript
const task = useTaskStore(s => s.tasks.find(t => t.taskId === taskId))
```

**Problem:**
The TaskDetailPage only looks up the task from the **already-loaded** `useTaskStore`. When you navigate directly to a task URL (or refresh the page), the store is empty because `fetchTasks()` was only called in the DashboardPage.

**Verification (2026-02-11):**
The `TaskDetailPage.tsx` now includes:
- A `fetchTask` method imported from the store (line 23)
- A useEffect that fetches the task if not in store (lines 34-53)
- Proper loading states (`taskLoading`, `taskNotFound`)
- The effect properly depends on `[taskId, task, fetchTask]`

---

### 2. Type Casting Bug in `taskStore.ts`

**Status: ✅ FIXED**

**File:** `src/stores/taskStore.ts:48`

**Code:**
```typescript
intent: (p.intent as string) ?? '',
```

**Problem:**
The cast `as string` will convert `undefined` to string literal `"undefined"`, which is truthy, so `?? ''` fallback never executes.

**Verification (2026-02-11):**
Line 69 in `taskStore.ts` now reads `intent: (p.intent as string | undefined) ?? ''` - the type cast is now properly `string | undefined` instead of just `string`, so the `?? ''` fallback will work correctly.

---

### 3. API Response Type Mismatch in `api.ts`

**Status: ✅ FIXED**

**File:** `src/services/api.ts:71`

**Code:**
```typescript
readFile: (path: string) => get<{ content: string; lines: number }>(`/api/files?path=${encodeURIComponent(path)}`),
```

**Problem:**
The frontend expects `{ content: string; lines: number }` but the backend at `httpServer.ts:247` returns `{ path: filePath, content }`.

**Verification (2026-02-11):**
Line 75 in `api.ts` now correctly types `readFile` as returning `{ path: string; content: string }`, matching the backend response which returns `{ path, content }`.

---

### 4. WebSocket Reconnection Race Condition

**Status: ✅ FIXED**

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
If connection fails and closes multiple times rapidly (e.g., network flapping), multiple timers can be set without canceling previous ones.

**Verification (2026-02-11):**
The `#scheduleReconnect` method in `ws.ts` (lines 99-107) now clears any existing timer before setting a new one:
```typescript
// Clear any existing timer to prevent overlapping reconnections (F4)
if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer)
```

---

## 🟠 High Priority Bugs

### 5. WebSocket Payload Access in `streamStore.ts`

**Status: ⚠️ STILL PRESENT**

**File:** `src/stores/streamStore.ts:29-33`

**Code:**
```typescript
handleUiEvent: (event) => {
  if (event.type === 'agent_output' || event.type === 'stream_delta') {
    const { taskId, kind, content } = event.payload
```

**Problem:**
The code assumes `agent_output` and `stream_delta` payloads have `{ taskId, kind, content }`. While this is correct for those events, `audit_entry` event type (line 51 in `types.ts`) has a completely different payload structure (`StoredAuditEntry`). The condition only filters for `agent_output` and `stream_delta`, so this is currently safe, but it's fragile and could cause issues if more event types are added.

**Verification (2026-02-11):**
Lines 29-31 still destructure without type guards: `const { taskId, kind, content } = event.payload`. While currently safe (only handles `agent_output` and `stream_delta`), the pattern remains fragile if new event types are added.

---

### 6. Missing React Effect Dependencies in `TaskDetailPage.tsx`

**Status: ⚠️ STILL PRESENT**

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

**Verification (2026-02-11):**
Line 67 uses `task` in the effect (accessing `task?.pendingInteractionId`) but the dependency array is `[taskId, task?.pendingInteractionId]`. If `task` changes but `pendingInteractionId` stays the same, the effect won't re-run.

---

### 7. Empty Form Submission in `InteractionPanel.tsx`

**Status: ✅ FIXED**

**File:** `src/components/InteractionPanel.tsx:77`

**Code:**
```typescript
onKeyDown={e => e.key === 'Enter' && respond()}
```

**Problem:**
Pressing Enter on the input field submits the form regardless of whether `inputValue` has content. For `Input` or `Composite` interaction kinds, submitting empty input may not be intended behavior and could confuse the agent.

**Verification (2026-02-11):**
Line 77 now includes validation: `onKeyDown={e => e.key === 'Enter' && !submitting && inputValue.trim() && respond()}`. The validation check `inputValue.trim()` prevents empty form submission.

---

### 8. Stale Closure Risk in `DashboardPage.tsx` Task Click Handler

**Status: ⚠️ STILL PRESENT**

**File:** `src/pages/DashboardPage.tsx:99`

**Code:**
```typescript
onClick={() => navigate(`/tasks/${task.taskId}`)}
```

**Problem:**
While this appears to work, there's a potential stale closure issue. The `task` object is captured from the `.map()` closure. If the task list updates while the click handler is pending (unlikely but possible in rapid updates), the handler could reference stale data.

**More importantly:** This navigation relies on the task being in the store, which relates to Bug #1 - if you navigate directly to a task URL, it won't be in the store.

**Verification (2026-02-11):**
Lines 99-102 still capture `task` from the map closure: `onClick={() => navigate(
`/tasks/${task.taskId}
`)}`. While the risk is low (task IDs are stable), the theoretical issue remains.

---

## 🟡 Medium Priority Issues

### 9. Stale Data in `ActivityPage.tsx`

**Status: ✅ FIXED (PARTIALLY)**

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

**Verification (2026-02-11):**
Lines 32-38 now implement auto-refresh every 10 seconds when connected:
```typescript
// Auto-refresh every 10 seconds when connected (F9)
const status = useConnectionStore(s => s.status)
useEffect(() => {
  if (status !== 'connected') return
  const interval = setInterval(fetchEvents, 10_000)
  return () => clearInterval(interval)
}, [status, fetchEvents])
```
However, it still doesn't subscribe to WebSocket events for true real-time updates as recommended.

---

### 10. useEffect Antipattern in `DashboardPage.tsx`

**Status: ⚠️ STILL PRESENT**

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

**Verification (2026-02-11):**
Line 35 still shows `useEffect(() => { fetchTasks() }, [fetchTasks])`. While this works (Zustand provides stable references), it remains an antipattern.

---

### 11. Task Duplicate Handling Edge Case in `taskStore.ts`

**Status: ✅ FIXED**

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

**Verification (2026-02-11):**
The `TaskCreated` case (lines 63-83) now implements proper upsert logic:
```typescript
// Upsert: update if exists, add if new
const idx = tasks.findIndex(t => t.taskId === p.taskId)
// ... create newTask
if (idx >= 0) {
  set({ tasks: tasks.map((t, i) => i === idx ? { ...t, ...newTask } : t) })
} else {
  set({ tasks: [...tasks, newTask] })
}
```

---

### 12. Missing Error Handling in `SettingsPage.tsx`

**Status: ✅ FIXED**

**File:** `src/pages/SettingsPage.tsx:12-16`

**Code:**
```typescript
const saveToken = () => {
  sessionStorage.setItem('coauthor-token', token)
  disconnect()
  setTimeout(connect, 100)
}
```

**Problem:**
1. No error handling if `sessionStorage` throws (e.g., in iframe contexts with storage restrictions)
2. `setTimeout` with arbitrary 100ms delay is not guaranteed to be sufficient for `disconnect()` to complete
3. No user feedback if saving fails

**Expected Behavior:**
Graceful handling of storage restrictions and proper disconnection before reconnection.

**Actual Behavior:**
May throw unhandled errors in restricted environments and may reconnect before disconnect completes.

**Verification (2026-02-11):**
The `saveToken` function (lines 24-40) now has:
1. Try-catch around `sessionStorage.setItem` with error status (lines 25-30)
2. Uses `reconnectTimerRef` and `statusTimerRef` for proper cleanup
3. Uses a 200ms delay for disconnect to settle
4. Shows user feedback for save status (lines 68-73)

---

### 13. Unused React Import in `StreamOutput.tsx`

**Status: ✅ FIXED**

**File:** `src/components/StreamOutput.tsx:1`

**Code:**
```typescript
import React from 'react'  // Not used
```

**Problem:**
Since React 17+ with the new JSX transform, the explicit `React` import is unnecessary unless you're using `React` APIs like `React.useState`. This file only uses hooks from 'react' directly.

**Impact:**
Build warning; dead code.

**Verification (2026-02-11):**
Line 5 now correctly imports only `useRef, useEffect` from 'react', no unused React import.

---

### 14. Multiple API Response Shape Mismatches (CRITICAL)

**Status: ✅ FIXED**

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

**Verification (2026-02-11):**
All API methods in `api.ts` now correctly unwrap responses:
- Line 51 (events): `.then(r => r.events)`
- Line 56 (pending): `.then(r => r.pending)`
- Line 71 (audit): `.then(r => r.entries)`
- Line 75 (files): Correct type `{ path: string; content: string }`

---

### 15. Inconsistent `streamId` Query Parameter Support (HIGH)

**Status: ⚠️ STILL PRESENT**

**File:** `src/services/api.ts:48-52` vs `src/infra/http/httpServer.ts:179-183`

**Problem:**
The frontend `api.getEvents` method allows passing a `streamId` (taskId) as a query parameter. However, the backend route `/api/events` completely ignores this parameter, only looking for `after`.

**Expected Behavior:**
The backend should filter events by `streamId` if provided, or the frontend should use the task-specific route `/api/tasks/:id/events`.

**Actual Behavior:**
The frontend thinks it's filtering by task, but it receives ALL events from the system, leading to potentially large data transfers and incorrect UI state if the frontend doesn't filter the result itself.

**Verification (2026-02-11):**
`api.ts:48-52` still passes `streamId` to the backend, but `httpServer.ts:179-187` (events endpoint) only looks for `after`, not `streamId`. The frontend thinks it's filtering by task but receives ALL events.

---

### 16. Agent Field Name Mismatch in Runtime API (HIGH)

**Status: ✅ FIXED**

**File:** `src/services/api.ts:61` vs `src/infra/http/httpServer.ts:218-222`

**Problem:**
Frontend expects `agents: Array<{ id: string; name: string }>`, but backend returns `agents: Array<{ id: string; displayName: string; description: string }>`.

**Impact:**
Any UI component trying to display the agent's name via `agent.name` will show `undefined`.

**Verification (2026-02-11):**
`api.ts:61-65` now correctly expects `displayName` (not `name`), matching the backend's response at `httpServer.ts:222-226`.

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

1. **Fix Task Loading (Bug #1)** ✅ FIXED
   - Add `fetchTask(taskId)` API call in TaskDetailPage when task not in store
   - Or use the existing `api.getTask()` to load individual tasks

2. **Fix API Response Shape Mismatches (Bug #3 & #14)** ✅ FIXED
   - Update `api.ts` to correctly unwrap `events`, `pending`, `entries`, and `path/content` from responses.
   - Align `agent` field names (`displayName` vs `name`).

3. **Fix the type casting bug (Bug #2)** ✅ FIXED
   - Change `intent: (p.intent as string) ?? ''` to proper type-safe handling

4. **Fix WebSocket reconnection race condition (Bug #4)** ✅ FIXED
   - Clear existing timer before setting new one

### Short-term Actions (High Priority)

5. Add proper validation to interaction form submission (Bug #7) ✅ FIXED
6. Fix React effect dependencies (Bug #6) ⚠️ STILL PRESENT
7. Separate UiEvent handlers by type (Bug #5) ⚠️ STILL PRESENT
8. Fix inconsistent `streamId` support (Bug #15) ⚠️ STILL PRESENT
9. Fix agent field names in UI (Bug #16) ✅ FIXED
10. Review stale closure risks (Bug #8) ⚠️ STILL PRESENT

### Long-term Actions (Medium Priority)

9. Implement real-time updates for Activity page (Bug #9) ✅ FIXED (partial)
10. Refactor useEffect patterns (Bug #10) ⚠️ STILL PRESENT
11. Implement proper upsert for task updates (Bug #11) ✅ FIXED
12. Add comprehensive error handling (Bug #12) ✅ FIXED
13. Clean up unused imports (Bug #13) ✅ FIXED

---

## References

- **Backend WebSocket Protocol:** `src/infra/ws/protocol.ts`
- **Backend HTTP Server:** `src/infra/http/httpServer.ts`
- **Domain Types:** `src/domain/events.ts`
- **UI Event Types:** `src/domain/ports/uiBus.ts`
- **Original Bug Report:** User question about task pages not opening

---

*Report compiled from code review session - all bugs verified against codebase at commit 49ede2c*
*Status verification completed: 2026-02-11*
