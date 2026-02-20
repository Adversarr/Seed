# App Container Lifecycle Cleanup Issue

## Summary

The App container created by `createApp()` in `src/interfaces/app/createApp.ts` starts several long-lived resources but exposes no lifecycle cleanup API. Without explicit teardown, multiple app instances or test runs can leak file watchers, subscriptions, and background tasks, causing duplicate events, memory growth, and flaky behavior.

## Problem Statement

**File:** `src/interfaces/app/createApp.ts` (lines 159-210)  
**Impact Level:** 1 (High)  
**Cost Level:** 1 (Low)  
**Refactoring Type:** Normal

## Root Causes

### 1. Missing Cleanup API on App

The returned `App` is a plain object with no `dispose` or `shutdown` method. There is no structured way to stop infrastructure and unsubscribe observers when an app instance is no longer needed.

**Location:** `src/interfaces/app/createApp.ts` lines 63-90 and 280-305

### 2. Untracked Audit Subscription

The subscription handle from `auditLog.entries$.subscribe(...)` is not retained. Without `unsubscribe()`, the callback continues emitting UI events after the app is torn down or replaced.

**Location:** `src/interfaces/app/createApp.ts` lines 188-191

**Current Code:**
```typescript
const uiBus = createUiBus()
auditLog.entries$.subscribe((entry) => {
  uiBus.emit({ type: 'audit_entry', payload: entry })
})
```

### 3. Workspace Provisioner Never Stopped

The `WorkspaceDirectoryProvisioner` subscribes to `EventStore.events$` and exposes `stop()`, but the app never calls it. The subscription remains active across new app instances.

**Location:** `src/interfaces/app/createApp.ts` lines 203-208  
**Implementation:** `src/infrastructure/workspace/workspaceDirectoryProvisioner.ts`

### 4. MCP Tool Extension Lifecycle Not Closed

The `McpToolExtensionManager` maintains client and transport connections and provides `stop()`. The app does not invoke `stop()`, leaving connections open across runs.

**Location:** `src/interfaces/app/createApp.ts` lines 159-168  
**Implementation:** `src/infrastructure/tools/mcpClient.ts`

## Impact

### 1. Resource Leakage
- Active subscriptions and transports accumulate with each `createApp()` call
- Long-lived handles per app instance: **3** (audit subscription, provisioner, MCP extension)
- Repeated test runs cause memory growth and potential file descriptor exhaustion

### 2. Duplicate Events
- Untracked audit subscriptions continue emitting UI events after app teardown
- Multiple app instances cause duplicate audit_entry events in the UI
- Flaky test behavior due to event timing issues

### 3. Operational Risks
- Background tasks continue running after CLI/server shutdown
- File watchers and MCP connections remain open, causing resource contention
- Difficult to embed the app in long-running processes (e.g., language servers, web servers)

## References

- **Files to Modify:**
  - `src/interfaces/app/createApp.ts` - Add `dispose()` and track subscriptions
  
- **Related Files:**
  - `src/infrastructure/tools/mcpClient.ts` - `McpToolExtensionManager.stop()`
  - `src/infrastructure/workspace/workspaceDirectoryProvisioner.ts` - `stop()` method
  - `src/agents/orchestration/runtimeManager.ts` - `stop()` method

- **Code Locations:**
  - `createApp.ts` lines 159-210 (MCP tool extension start)
  - `createApp.ts` lines 188-191 (audit subscription)
  - `createApp.ts` lines 203-208 (workspace provisioner)
