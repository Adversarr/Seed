/**
 * Shared - Async Mutex
 *
 * Promise-chain-based mutual exclusion lock for serializing async
 * operations within a single Node.js process.
 */
export class AsyncMutex {
  #queue: Promise<void> = Promise.resolve()

  /**
   * Execute `fn` while holding the lock.
   *
   * If another call is already running, this call waits for it first.
   */
  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const previous = this.#queue
    this.#queue = gate

    await previous
    try {
      return await fn()
    } finally {
      release()
    }
  }
}
