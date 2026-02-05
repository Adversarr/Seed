import { Subject, type Observable } from 'rxjs'
import type { UiBus, UiEvent } from '../domain/ports/uiBus.js'

export class SubjectUiBus implements UiBus {
  readonly #subject = new Subject<UiEvent>()

  get events$(): Observable<UiEvent> {
    return this.#subject.asObservable()
  }

  emit(event: UiEvent): void {
    this.#subject.next(event)
  }
}

export function createUiBus(): UiBus {
  return new SubjectUiBus()
}

