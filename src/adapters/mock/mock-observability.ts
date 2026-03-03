// Mock observability — captures all emitted events for assertions

import type { Observability } from "../../ports/observability.js";
import type { DomainEvent } from "../../core/types.js";

export class MockObservability implements Observability {
  readonly events: DomainEvent[] = [];

  emit(event: DomainEvent): void {
    this.events.push(event);
  }

  /** Filter events by type for assertions. */
  ofType<T extends DomainEvent["type"]>(
    type: T
  ): Extract<DomainEvent, { type: T }>[] {
    return this.events.filter((e) => e.type === type) as Extract<DomainEvent, { type: T }>[];
  }

  clear(): void {
    this.events.length = 0;
  }
}
