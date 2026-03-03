// Console logger — one structured JSON line per domain event

import type { Observability } from "../ports/observability.js";
import type { DomainEvent } from "../core/types.js";

export class ConsoleLogger implements Observability {
  emit(event: DomainEvent): void {
    try {
      const line = JSON.stringify(event);
      process.stdout.write(line + "\n");
    } catch {
      // Never throw from observability
    }
  }
}
