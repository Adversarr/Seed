import { Subject } from 'rxjs'
import type { Subscribable } from '../core/ports/subscribable.js'
import type { UiBus, UiEvent } from '../core/ports/uiBus.js'

export class SubjectUiBus implements UiBus {
  readonly #subject = new Subject<UiEvent>()

  get events$(): Subscribable<UiEvent> {
    return this.#subject.asObservable()
  }

  emit(event: UiEvent): void {
    try {
      this.#subject.next(event)
    } catch (err) {
      console.error('[UiBus] subscriber error during emit:', err)
    }
  }
}

export function createUiBus(): UiBus {
  return new SubjectUiBus()
}

