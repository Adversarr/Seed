import { Subject } from 'rxjs'
import type { Subscribable } from '../domain/ports/subscribable.js'
import type { UiBus, UiEvent } from '../domain/ports/uiBus.js'

export class SubjectUiBus implements UiBus {
  readonly #subject = new Subject<UiEvent>()

  get events$(): Subscribable<UiEvent> {
    return this.#subject.asObservable()
  }

  emit(event: UiEvent): void {
    this.#subject.next(event)
  }
}

export function createUiBus(): UiBus {
  return new SubjectUiBus()
}

