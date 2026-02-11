/**
 * Infrastructure Layer - Async Mutex
 *
 * A simple promise-chain-based mutual exclusion lock for serialising
 * async operations within a single Node.js process.
 *
 * Replaces the old `sleepSync` + `openSync('wx')` file-based lock that
 * blocked the event loop with `Atomics.wait`.  For a single-process
 * server an in-process mutex is sufficient and fully non-blocking.
 */

export class AsyncMutex {
  #queue: Promise<void> = Promise.resolve()

  /**
   * Execute `fn` while holding the lock.
   *
   * If another call to `runExclusive` is in progress, this call will
   * await its completion before starting.  Guarantees sequential (FIFO)
   * execution of all submitted functions.
   */
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
}
