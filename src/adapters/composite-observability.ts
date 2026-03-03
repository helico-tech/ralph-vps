// Composite observability — fans out events to child adapters

import type { Observability } from "../ports/observability.js";
import type { DomainEvent } from "../core/types.js";

export class CompositeObservability implements Observability {
  constructor(private readonly children: Observability[]) {}

  emit(event: DomainEvent): void {
    for (const child of this.children) {
      try {
        child.emit(event);
      } catch (err) {
        // Error isolation: one failing child must not prevent others
        process.stderr.write(
          `[observability] child failed: ${err instanceof Error ? err.message : String(err)}\n`
        );
      }
    }
  }
}
