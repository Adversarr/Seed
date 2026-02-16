import { mkdir } from 'node:fs/promises'
import type { StoredEvent } from '../../core/events/events.js'
import type { EventStore } from '../../core/ports/eventStore.js'
import type { WorkspacePathResolver } from '../../core/ports/tool.js'
import type { Subscription } from '../../core/ports/subscribable.js'

/**
 * Provision scoped workspace directories based on task lifecycle events.
 *
 * Behavior:
 * - TaskStarted => ensure private:/ root exists for the task.
 * - Child TaskCreated => ensure shared:/ root exists for the task group.
 *
 * All filesystem operations are idempotent (`mkdir -p` semantics).
 */
export class WorkspaceDirectoryProvisioner {
  readonly #store: EventStore
  readonly #workspaceResolver: WorkspacePathResolver
  #subscription: Subscription | null = null

  constructor(opts: {
    store: EventStore
    workspaceResolver: WorkspacePathResolver
  }) {
    this.#store = opts.store
    this.#workspaceResolver = opts.workspaceResolver
  }

  start(): void {
    if (this.#subscription) return

    this.#subscription = this.#store.events$.subscribe((event) => {
      void this.#onEvent(event)
    })
  }

  stop(): void {
    this.#subscription?.unsubscribe()
    this.#subscription = null
  }

  async #onEvent(event: StoredEvent): Promise<void> {
    if (event.type === 'TaskStarted') {
      await this.#ensurePrivateRoot(event.payload.taskId)
      return
    }

    if (event.type === 'TaskCreated' && event.payload.parentTaskId) {
      await this.#ensureSharedRoot(event.payload.taskId)
    }
  }

  async #ensurePrivateRoot(taskId: string): Promise<void> {
    try {
      const privateRoot = await this.#workspaceResolver.resolvePath(taskId, 'private:/')
      await mkdir(privateRoot.absolutePath, { recursive: true })
    } catch (error) {
      console.warn('[workspaceDirectoryProvisioner] Failed to ensure private workspace root:', error)
    }
  }

  async #ensureSharedRoot(taskId: string): Promise<void> {
    try {
      const sharedRoot = await this.#workspaceResolver.resolvePath(taskId, 'shared:/')
      await mkdir(sharedRoot.absolutePath, { recursive: true })
    } catch (error) {
      console.warn('[workspaceDirectoryProvisioner] Failed to ensure shared workspace root:', error)
    }
  }
}
