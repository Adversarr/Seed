/**
 * Master/client process discovery.
 *
 * Logic:
 * 1. Read lock file → if absent/invalid, return 'master'.
 * 2. Check PID alive → if dead, clean stale lock, return 'master'.
 * 3. HTTP health check → if fails, clean stale lock, return 'master'.
 * 4. All passed → return 'client' with connection details.
 */

import {
  lockFilePath,
  readLockFile,
  removeLockFile,
  isProcessAlive,
} from './lockFile.js'

// ============================================================================
// Types
// ============================================================================

export type DiscoveryResult =
  | { mode: 'master' }
  | { mode: 'client'; port: number; token: string }

// ============================================================================
// Discovery
// ============================================================================

export async function discoverMaster(baseDir: string): Promise<DiscoveryResult> {
  const path = lockFilePath(baseDir)
  const data = readLockFile(path)

  if (!data) return { mode: 'master' }

  // Check if PID is still alive
  if (!isProcessAlive(data.pid)) {
    removeLockFile(path)
    return { mode: 'master' }
  }

  // HTTP health check with timeout
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 2000)
    const res = await fetch(`http://127.0.0.1:${data.port}/api/health`, {
      signal: controller.signal,
    })
    clearTimeout(timeout)
    if (res.ok) {
      return { mode: 'client', port: data.port, token: data.token }
    }
  } catch {
    // Health check failed — stale lock
  }

  removeLockFile(path)
  return { mode: 'master' }
}
