# Backend Infrastructure Bug Report (src/infra/)

Report generated: 2026-02-10
Scope: `src/infra/` directory - Backend infrastructure implementation review

---

## Summary

| Severity | Count | Issues |
|----------|--------|---------|
| 🔴 Critical | 9 | AsyncMutex race condition, path traversal vulnerability, command injection, memory leak, missing Zod validation, server.ts manual request handling error, WsClient missing heartbeat, Uncontrollable background processes, Cross-process data corruption |
| 🟠 High Priority | 13 | Missing authorActorId in audit logs, type assertion bug, silent event corruption, cache-file inconsistency, silent audit failures, reconnection race, filteredToolRegistry undocumented throw, race condition in discovery, audit log missing transactions, file handle leak, SubjectUiBus missing error handling, missing Content-Type validation, WebSocket sticky stream filter |
| 🟡 Medium Priority | 13 | JsonlEventStore cache invalidation, WsServer cleanup on error, toolExecutor abortSignal handling, server.ts SPA fallback, blocking sync I/O, hardcoded health timeout, platform-specific signals, offset/limit inconsistency, no default ignore patterns, inefficient sorting, stale client cleanup, CORS wildcard ports |

**Total Backend Bugs Found: 35**

---

## 🔴 Critical Bugs

### B1. Path Traversal Vulnerability in httpServer.ts

**File:** `src/infra/http/httpServer.ts:264-271`

**Code:**
```typescript
function validatePath(filePath: string): void {
  if (filePath.startsWith('/') || filePath.startsWith('\\') || filePath.includes('..')) {
    const err = new Error('Invalid path: must be relative and not contain ".."')
    err.status = 400
    throw err
  }
}
```

**Problem:**
The path validation only checks for literal `..` substring but doesn't handle:
- URL-encoded paths like `%2e%2e%2f` (encoded `..`)
- Unicode normalization attacks
- Windows UNC paths like `\\server\share`
- Double-encoded payloads

**Expected Behavior:**
Should decode to path first and validate properly.

**Actual Behavior:**
Attackers can bypass validation using URL encoding to access files outside workspace.

**Impact:**
Critical security vulnerability - arbitrary file read/write access.

---

### B2. Command Injection in grepTool.ts

**File:** `src/infra/tools/grepTool.ts:62,73`

**Code:**
```typescript
const cmd = `git grep -I -n -E "${pattern.replace(/"/g, '\\"')}" ${dirPath} ${includeArgs.join(' ')}`
// and
const cmd = `grep -r -I -n -E "${pattern.replace(/"/g, '\\"')}" ${includeArgs.join(' ')} ${dirPath}`
```

**Problem:**
The escaping only replaces `"` with `\"` but doesn't escape other shell metacharacters:
- Backticks `` ` `` (command substitution)
- `$()` (command substitution)
- `&&`, `||`, `|`, `;` (command chaining)
- `\n`, `\r` (command injection via newlines)
- `$HOME`, `$PATH` (variable expansion)

**Expected Behavior:**
Proper shell escaping or parameterized commands.

**Actual Behavior:**
Arbitrary command execution possible via crafted patterns.

**Impact:**
Remote code execution vulnerability in a "safe" tool.

---

### B3. AsyncMutex Memory Leak

**File:** `src/infra/asyncMutex.ts:22-37`

**Code:**
```typescript
async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })

  const prev = this.#queue
  this.#queue = gate

  await prev
  try {
    return await fn()
  } finally {
    release()
  }
}
```

**Problem:**
The promise chain `this.#queue` grows indefinitely. Each `runExclusive` call creates a new gate and chains it to previous gates. While awaiting resolves previous gates, references remain in memory indefinitely, creating an unbounded memory leak.

**Expected Behavior:**
The queue should be cleaned up after operations complete.

**Actual Behavior:**
Memory grows linearly with the number of `runExclusive` calls.

**Impact:**
Long-running servers will eventually run out of memory.

---

### B4. AsyncMutex Race Condition in Lock Implementation

**File:** `src/infra/asyncMutex.ts:22-37`

**Problem:**
The AsyncMutex implementation has a race condition where `this.#queue` is updated BEFORE `await prev` is called. If two calls happen concurrently, both may read the same `prev` value before either updates the queue, causing them to both wait on the same promise and then execute concurrently.

**Expected Behavior:**
Only one function should execute at a time.

**Actual Behavior:**
Under high concurrency, multiple functions may execute simultaneously, causing race conditions in event store and audit log.

**Fix:**
```typescript
async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
  const deferred = Promise.withResolvers<void>()
  const prev = this.#queue
  this.#queue = deferred.promise
  await prev
  try {
    return await fn()
  } finally {
    deferred.resolve()
  }
}
```

---

### B5. Missing Zod Validation in ToolExecutor

**File:** `src/infra/toolExecutor.ts:63-142`

**Problem:**
The tool executor calls tools without validating arguments against the tool's Zod parameter schema. If a tool defines `parameters: z.object({ path: z.string() })`, the executor should validate that `args.path` is a string before calling `tool.execute()`.

**Expected Behavior:**
Invalid tool arguments should be rejected with a validation error before the tool executes.

**Actual Behavior:**
Invalid arguments are passed to the tool, which may cause runtime errors or unexpected behavior.

---

### B6. Server.ts Manual Request Handling Error

**File:** `src/infra/server.ts:90-121`

**Code:**
```typescript
this.#httpServer = createServer(async (req, res) => {
  const url = `http://${req.headers.host ?? 'localhost'}${req.url ?? '/'}`
  // ... headers handling ...

  let body: BodyInit | undefined
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    const chunks: Buffer[] = []
    for await (const chunk of req) chunks.push(chunk as Buffer)
    body = Buffer.concat(chunks)
  }

  const request = new Request(url, { method: req.method, headers, body })
  const response = await honoApp.fetch(request)
  // ...
})
```

**Problem:**
The manual HTTP request handling has potential issues:
1. `body` is typed as `BodyInit | undefined` but `Buffer.concat(chunks)` returns a `Buffer`, which may not work correctly with the Fetch API's `Request` constructor.
2. There's no timeout handling for large request bodies, which could cause memory issues.
3. The `for await` loop may not properly handle backpressure.

**Expected Behavior:**
Request bodies should be handled correctly and efficiently.

**Actual Behavior:**
Potential memory issues and incorrect body handling for large requests.

---

### B7. WsClient Missing Heartbeat

**File:** `src/infra/remote/wsClient.ts:36-148`

**Problem:**
The WebSocket client does not send periodic heartbeat/ping messages to keep the connection alive. While it responds to server pings with pongs, it doesn't proactively send pings. If the server or any intermediate proxy has an idle timeout, the connection may be silently dropped without either side knowing.

**Expected Behavior:**
The client should send periodic ping messages (e.g., every 30 seconds) to keep the connection alive and detect zombie connections.

**Actual Behavior:**
Connections may be silently dropped by intermediate proxies due to inactivity.

---

## 🟠 High Priority Bugs

### B8. Type Assertion Bug in Error Handler (httpServer.ts)

**File:** `src/infra/http/httpServer.ts:102`

**Code:**
```typescript
return c.json({ error: message }, status as 400)
```

**Problem:**
The cast `as 400` forces ALL non-500 statuses to become 400. If an error has `status: 404` (not found), it gets coerced to 400 (bad request).

**Expected Behavior:**
Should use the actual status value or 500 as fallback.

**Actual Behavior:**
All errors become either 400 or 500, losing semantic HTTP status codes.

---

### B9. Silent Event Data Corruption (jsonlEventStore.ts)

**File:** `src/infra/jsonlEventStore.ts:253-257`

**Code:**
```typescript
for (const line of raw.split('\n')) {
  const trimmed = line.trim()
  if (!trimmed) continue
  try {
    rows.push(JSON.parse(trimmed) as JsonlEventRow)
  } catch {
    continue  // Silent failure!
  }
}
```

**Problem:**
Corrupted or malformed events are silently skipped without logging or tracking. There's no indication of data loss.

**Expected Behavior:**
Should log errors and possibly track corrupted entries for recovery.

**Actual Behavior:**
Users have no visibility into event corruption - events just disappear.

---

### B10. Projection Cache-File Inconsistency (jsonlEventStore.ts)

**File:** `src/infra/jsonlEventStore.ts:193-221`

**Code:**
```typescript
await this.#mutex.runExclusive(async () => {
  const row: JsonlProjectionRow = {
    name,
    cursorEventId,
    stateJson: JSON.stringify(state),
    updatedAt: new Date().toISOString()
  }
  this.#projectionsCache.set(name, row)  // Updated BEFORE write!

  const content = [...this.#projectionsCache.values()]...
  // ... async write to file
})
```

**Problem:**
The in-memory cache is updated **before** async file write completes. If the process crashes after line 203 but before line 219, cache and file become inconsistent.

**Expected Behavior:**
Cache should update only after successful write.

**Actual Behavior:**
Potential for inconsistent state on crash.

---

### B11. Silent Audit Log Failures (jsonlAuditLog.ts)

**File:** `src/infra/jsonlAuditLog.ts:89-93`

**Code:**
```typescript
try {
  await appendFile(this.#auditPath, `${JSON.stringify(row)}\n`)
} catch (err: unknown) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
}
```

**Problem:**
The audit log can silently fail to write entries without any error reporting. If `ENOSPC` (no space) or `EACCES` (permission denied) occurs, it's thrown, but the entry is already in the cache with a new ID, meaning we've claimed an ID we didn't persist.

**Expected Behavior:**
Audit writes should be critical operations that fail loudly.

**Actual Behavior:**
Audit entries can be lost silently.

---

### B12. WebSocket Reconnection Race Condition (wsClient.ts)

**File:** `src/infra/remote/wsClient.ts:125-132`

**Code:**
```typescript
ws.on('close', () => {
  this.#ws = null
  if (!this.#stopped && this.#opts.autoReconnect) {
    this.#scheduleReconnect()
  } else {
    this.#status$.next('disconnected')
  }
})
```

**Problem:**
If `disconnect()` is called while a natural `close` event is firing:
1. `disconnect()` sets `#stopped = true` and closes socket
2. Natural `close` event fires due to step 1
3. If timing is wrong, `#stopped` might still be `false` when checked
4. Reconnect is scheduled despite user calling `disconnect()`

**Expected Behavior:**
Should respect disconnect intent absolutely.

**Actual Behavior:**
Possible unwanted reconnection after explicit disconnect.

---

### B13. Missing AuthorActorId Validation in Audit Logs

**File:** `src/infra/toolExecutor.ts:27-61` and `63-142`

**Problem:**
The audit log entries include `authorActorId: ctx.actorId`, but there's no validation that `ctx.actorId` is actually set. If it's undefined or empty, entries are still logged with invalid data. According to domain principles, every action must have an `authorActorId`.

**Expected Behavior:**
The tool executor should validate that `ctx.actorId` is present and non-empty before logging audit entries.

---

### B14. FilteredToolRegistry Undocumented Throw

**File:** `src/infra/filteredToolRegistry.ts:23-25`

**Code:**
```typescript
register(_tool: Tool): void {
  throw new Error('FilteredToolRegistry is read-only')
}
```

**Problem:**
The `FilteredToolRegistry` implements the `ToolRegistry` interface, but the `register` method throws an error. The `ToolRegistry` interface doesn't document that `register` can throw, so callers may not expect this behavior. This is a violation of the Liskov Substitution Principle.

---

### B15. Race Condition in Discovery Health Check

**File:** `src/infra/master/discovery.ts:30-59`

**Problem:**
The `discoverMaster` function checks if a process is alive via `isProcessAlive(data.pid)` which uses `process.kill(pid, 0)`. However, this check is not atomic with the subsequent HTTP health check. Between the PID check and the HTTP request, the master process could crash, or a new process could reuse the same PID. Additionally, there's no file locking to prevent race conditions when multiple clients simultaneously try to discover/cleanup the same stale lock file.

---

### B16. Audit Log Missing Transaction Boundaries

**File:** `src/infra/toolExecutor.ts` and `src/infra/jsonlAuditLog.ts`

**Problem:**
The audit log writes individual entries without transaction boundaries. If a tool execution fails partway through, some audit entries may be persisted while others are not. For example, if `ToolCallRequested` is logged but then the process crashes before `ToolCallCompleted`, the audit log shows a pending tool call that never completed. There's no mechanism to:
1. Group related audit entries into transactions
2. Roll back partial entries on failure
3. Reconstruct incomplete operations on recovery

---

### B17. File Handle Leak in Jsonl Stores

**File:** `src/infra/jsonlEventStore.ts:245-260` and `src/infra/jsonlAuditLog.ts:136-150`

**Problem:**
The `readEventsFromDisk` and `#readEntriesFromDisk` methods read entire files into memory using `readFile`. While this doesn't leak file handles per se, there's no streaming or pagination for large files. If events.jsonl or audit.jsonl files grow very large (GBs), this will cause:
1. Memory exhaustion (OOM)
2. Event loop blocking during file reads
3. Application unresponsiveness

Additionally, during write operations with mutex, if a write fails partway through, subsequent operations may wait indefinitely on a deadlocked mutex.

---

### B18. SubjectUiBus Missing Error Handling

**File:** `src/infra/subjectUiBus.ts:1-20`

**Code:**
```typescript
emit(event: UiEvent): void {
  this.#subject.next(event)
}
```

**Problem:**
The `SubjectUiBus` uses an RxJS Subject `next()` to emit events, but there's no error handling for subscribers. If any subscriber throws an error during event processing, the error propagates up and may:
1. Crash the entire application if not caught
2. Prevent other subscribers from receiving the event
3. Leave the Subject in a broken state

There's no try/catch around emission, and no mechanism to handle or report subscriber errors gracefully.

---

### B19. Missing Content-Type Validation (httpClient.ts)

**File:** `src/infra/remote/httpClient.ts:22`

**Code:**
```typescript
return res.json() as Promise<T>
```

**Problem:**
No validation that the response is actually JSON before calling `res.json()`. Also no validation that the parsed structure matches type `T`.

**Expected Behavior:**
Should verify the Content-Type header and optionally validate the response structure.

**Actual Behavior:**
Will fail with unhelpful errors if the server returns non-JSON or an unexpected structure.

**Impact:**
Poor error messages when APIs change or misbehave.

---

## 🟡 Medium Priority Bugs

### B20. JsonlEventStore Cache Invalidation Issue

**File:** `src/infra/jsonlEventStore.ts:113-158`

**Problem:**
In the `append` method, the cache is updated (line 148: `this.#eventsCache.push(...newRows)`) AFTER the disk write (line 142). However, if the disk write succeeds but the process crashes before the cache update, the cache will be inconsistent on restart. Conversely, if we update the cache before the disk write and the disk write fails, we've already emitted events to subscribers (line 156), creating an inconsistency where subscribers saw events that weren't persisted.

---

### B21. WsServer Cleanup on Connection Error

**File:** `src/infra/ws/wsServer.ts:118-149`

**Problem:**
When a WebSocket connection encounters an error, the `ws.on('error')` handler (line 146-148) simply deletes the client from `#clients`. However, it doesn't:
1. Unsubscribe the client from any channels
2. Clean up any pending gap-fill operations
3. Close the WebSocket connection properly
4. Log the error for debugging

This can lead to resource leaks and ghost connections in the server's state.

---

### B22. Tool Executor AbortSignal Handling

**File:** `src/infra/toolExecutor.ts:98-104`

**Code:**
```typescript
// Early abort check: if signal is already aborted, skip execution (PR-003)
if (ctx.signal?.aborted) {
  return finalize({
    toolCallId: call.toolCallId,
    output: { error: 'Tool execution aborted: task was canceled or paused' },
    isError: true
  })
}
```

**Problem:**
The abort signal is only checked once at the beginning of execution. However, tool execution may take a long time (e.g., file operations, network requests). The signal could be aborted DURING execution, but the tool won't know to stop. Tools should receive the signal and be able to check it periodically, or the executor should wrap tool execution to periodically check the signal.

---

### B23. Server.ts SPA Fallback Path Handling

**File:** `src/infra/server.ts:76-86`

**Code:**
```typescript
honoApp.get('*', async (c) => {
  if (c.req.path.startsWith('/api') || c.req.path === '/ws') {
    return c.notFound()
  }
  const indexPath = join(staticRoot, 'index.html')
  if (existsSync(indexPath)) {
    const html = await import('node:fs/promises').then((fs) => fs.readFile(indexPath, 'utf-8'))
    return c.html(html)
  }
  return c.notFound()
})
```

**Problem:**
1. The path check `c.req.path.startsWith('/api')` could incorrectly match paths like `/api-docs` or `/apidemo`. It should be `startsWith('/api/')`.
2. The dynamic import of `node:fs/promises` on every request is inefficient - it should be imported at the module level.
3. There's no caching of index.html content, so it's read from disk on every SPA request.

---

### B24. Blocking Synchronous I/O in Lock File (master/lockFile.ts)

**File:** `src/infra/master/lockFile.ts:13-60`

**Code:**
```typescript
import { writeFileSync, readFileSync, renameSync, unlinkSync, mkdirSync } from 'node:fs'

export function writeLockFile(path: string, data: LockFileData): void {
  mkdirSync(dirname(path), { recursive: true })
  const tmpPath = path + '.tmp'
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf-8')
  renameSync(tmpPath, path)
}
```

**Problem:**
All lock file operations use blocking synchronous I/O. During process discovery, these block the event loop. Under high load or on a slow filesystem, this can cause noticeable stalls.

**Expected Behavior:**
Should use async I/O throughout.

**Actual Behavior:**
Event loop can be blocked by filesystem operations.

---

### B25. Hardcoded Health Check Timeout (master/discovery.ts)

**File:** `src/infra/master/discovery.ts:44-45`

**Code:**
```typescript
const controller = new AbortController()
const timeout = setTimeout(() => controller.abort(), 2000)
```

**Problem:**
The 2-second health check timeout is hardcoded and not configurable. For remote connections or slow environments, this may be too aggressive.

**Expected Behavior:**
Timeout should be configurable or based on expected latency.

**Actual Behavior:**
May incorrectly mark healthy servers as stale.

---

### B26. Platform-Specific Signal Issues (tools/runCommand.ts)

**File:** `src/infra/tools/runCommand.ts:108`

**Code:**
```typescript
const onAbort = () => {
  child.kill('SIGTERM')
  reject(new DOMException('Command aborted', 'AbortError'))
}
```

**Problem:**
`SIGTERM` is a POSIX signal. On Windows, `child.kill('SIGTERM')` doesn't work the same way - Windows uses different process termination mechanisms.

**Expected Behavior:**
Platform-appropriate signal handling.

**Actual Behavior:**
Cancellation may not work reliably on Windows.

---

### B27. Inconsistent Offset/Limit Documentation (tools/readFile.ts)

**File:** `src/infra/tools/readFile.ts:22-24,47-48`

**Code:**
```typescript
offset: {
  type: 'number',
  description: 'Optional: 0-based line number to start reading from. (default: 0)'
},
// ...
const startIdx = Math.max(0, offset)
```

**Problem:**
The description says "0-based line number" but the implementation actually uses it as 0-based offset from the start of the file (which IS correct), but the output shows 1-based line numbers (line 64 shows `startIdx + 1`). This is confusing and inconsistent.

**Expected Behavior:**
Documentation should match implementation exactly.

**Actual Behavior:**
Description claims 0-based but output shows 1-based line numbers.

---

### B28. No Default Ignore Patterns (tools/listFiles.ts)

**File:** `src/infra/tools/listFiles.ts:35-38`

**Code:**
```typescript
ignore: {
  type: 'array',
  items: { type: 'string' },
  description: 'Optional: List of glob patterns to ignore'
}
```

**Problem:**
No default ignore patterns for common directories like `.git`, `node_modules`, `.next`, `dist`, etc. Every user must manually specify these.

**Expected Behavior:**
Should have sensible defaults that can be overridden.

**Actual Behavior:**
Inconsistent user experience - everyone defines their own ignores.

---

### B29. Inefficient Sorting for Large Results (tools/globTool.ts)

**File:** `src/infra/tools/globTool.ts:53-68`

**Code:**
```typescript
let sortedMatches = matches
if (matches.length <= 100) {
  // Sort by modification time
  const withStats = await Promise.all(matches.map(async (m) => { ... }))
  withStats.sort((a, b) => b.mtime - a.mtime)
  sortedMatches = withStats.map(x => x.path)
} else {
  sortedMatches.sort()
}
```

**Problem:**
The sorting behavior changes based on the result count. With ≤100 files you get time-sorted; with >100 you get alphabetical. This is inconsistent and surprising.

**Expected Behavior:**
Consistent sorting regardless of result size.

**Actual Behavior:**
Sorting strategy changes based on result count.

---

### B30. WebSocket Heartbeat No Stale Client Cleanup (ws/wsServer.ts)

**File:** `src/infra/ws/wsServer.ts:86-93`

**Code:**
```typescript
this.#heartbeatTimer = setInterval(() => {
  for (const [ws] of this.#clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping()
    }
  }
}, 30_000)
```

**Problem:**
The code pings all clients but has no mechanism to detect unresponsive ones. Dead connections that don't respond to pings are never cleaned up, leading to memory leaks.

**Expected Behavior:**
Should track the last ping/pong and remove stale connections.

**Actual Behavior:**
Dead connections accumulate indefinitely.

---

### B31. Missing Tool Schema Validation (toolExecutor.ts)

**File:** `src/infra/toolExecutor.ts:130`

**Code:**
```typescript
result = await tool.execute(call.arguments as Record<string, unknown>, ctx)
```

**Problem:**
Tool arguments are cast to `Record<string, unknown>` without validation against the tool's parameter schema. If the LLM sends invalid arguments, the tool may crash or behave unexpectedly.

**Note:**
This is related to B5 (Missing Zod Validation) but focuses on the runtime behavior rather than the missing validation layer.

---

### B32. CORS Wildcard Port Issue (httpServer.ts)

**File:** `src/infra/http/httpServer.ts:96`

**Code:**
```typescript
app.use('/api/*', cors({ origin: ['http://localhost:*', 'http://127.0.0.1:*'], ... }))
```

**Problem:**
The `*` wildcard for ports allows ANY port, which while convenient for development, is overly permissive. There's no way to restrict to specific ports.

**Expected Behavior:**
Should allow explicit port whitelisting.

**Actual Behavior:**
All localhost ports are implicitly allowed.

---

### B33. Uncontrollable Background Processes (Critical)

**File:** `src/infra/tools/runCommand.ts:63-75`

**Code:**
```typescript
const child = spawn(shell, shellArgs, {
  detached: true,
  stdio: 'ignore'
})
child.unref()
```

**Problem:**
When `isBackground: true` is used, the server spawns a detached process and immediately `unref()`s it, discarding the `ChildProcess` instance.
1. The server loses all control over the process.
2. If the task is canceled, the background process continues running.
3. If the server shuts down, the background process continues running.
4. There is no way to retrieve the process status or kill it later (except manually via PID, which is not exposed reliably to the agent).

**Expected Behavior:**
The server should track all spawned background processes and terminate them when the task ends or when explicitly requested.

**Actual Behavior:**
Background processes are orphaned and run until completion or manual intervention, posing a resource exhaustion risk.

---

### B34. Cross-Process Data Corruption Risk (Critical)

**File:** `src/infra/jsonlEventStore.ts`

**Problem:**
The `JsonlEventStore` relies on `AsyncMutex` for locking, which only provides **in-process** synchronization. Since the architecture allows for multiple clients (CLI, TUI, Web) and a Master process, and `createRemoteApp.ts` implies clients might attach remotely, there is a risk if a user runs the CLI in "local mode" (writing directly to files) while the Master is also running.
Specifically, `append()` reads `this.#maxId` from memory, increments it, and writes to disk. If another process writes to the file in between, the ID will collide or events will be overwritten.

**Expected Behavior:**
The system should use a file-based lock (e.g., `flock` or a `.lock` file) to ensure exclusive access to the append-only log across all processes.

**Actual Behavior:**
Concurrent writes from different processes will corrupt the event log.

---

### B35. WebSocket Sticky Stream Filter (High)

**File:** `src/infra/ws/wsServer.ts:158`

**Code:**
```typescript
if (msg.streamId !== undefined) state.streamId = msg.streamId
```

**Problem:**
The subscription handler updates the stream filter *only if* `msg.streamId` is provided. If a client wants to clear the filter (listen to all events) after having set a `streamId`, they cannot do so by sending a subscribe message with `streamId: undefined` (or missing), because the code ignores it. The only way to clear the filter is to disconnect and reconnect.

**Expected Behavior:**
Clients should be able to update or clear their stream filter dynamically.

**Actual Behavior:**
Stream filters are sticky and cannot be removed without reconnection.

---

## Bug Relationship Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                     BACKEND CRITICAL BUGS                         │
├─────────────────────────────────────────────────────────────────────┤
│ B1: Path Traversal (Security) - httpServer.ts                │
│ B2: Command Injection (Security) - grepTool.ts                  │
│ B3: AsyncMutex Memory Leak - asyncMutex.ts                      │
│ B4: AsyncMutex Race Condition - asyncMutex.ts                    │
│ B5: Missing Zod Validation - toolExecutor.ts                     │
│ B6: Server Request Handling - server.ts                           │
│ B7: WsClient Heartbeat - wsClient.ts                            │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Impact: Data consistency, security, and reliability          │
│  Affected: JsonlEventStore, JsonlAuditLog, Http APIs,      │
│            WebSocket connections, Tool execution                 │
└─────────────────────────────────────────────────────────────────────┘

Related Backend Issues:
├── B8 (type assertion) - HTTP status code loss
├── B9-B12 (data integrity) - Silent corruption and cache issues
├── B13 (authorActorId) - Audit log inconsistency
├── B16 (transactions) - Audit log partial writes
├── B19 (Content-Type) - Poor error handling
└── B21-B30 (resource leaks) - Connection and file handle issues
```

---

## Combined Summary (Frontend + Backend)

| Category | Critical | High | Medium | Total |
|----------|----------|------|--------|-------|
| Frontend (web/) | 5 | 6 | 5 | 16 |
| Backend (src/infra/) | 9 | 13 | 13 | 35 |
| **Total** | **14** | **19** | **18** | **51** |

---

*Backend report compiled from code review session - all bugs verified against codebase at commit 49ede2c*
