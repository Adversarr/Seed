/**
 * Domain Layer - Ports
 *
 * Minimal typed pub/sub abstraction.
 *
 * Domain ports depend on this interface instead of any concrete library
 * (e.g. RxJS). Infrastructure implementations are free to use RxJS
 * Subject or any other mechanism internally — the contract at the
 * boundary is deliberately minimal so that adapters (Web/Socket, test
 * doubles, etc.) never need to import a specific reactive library.
 *
 * Structurally compatible with RxJS Observable — an Observable returned
 * by `Subject.asObservable()` satisfies `Subscribable<T>` automatically.
 */

// ============================================================================
// Subscription Handle
// ============================================================================

/**
 * Returned by `Subscribable.subscribe()`.
 * Call `unsubscribe()` to stop receiving values.
 */
export interface Subscription {
  unsubscribe(): void
}

// ============================================================================
// Subscribable Interface
// ============================================================================

/**
 * A minimal observable-like contract: subscribe with a callback, get a
 * handle to unsubscribe.
 *
 * This is the only pub/sub primitive the domain layer exposes.
 */
export interface Subscribable<T> {
  subscribe(callback: (value: T) => void): Subscription
}
