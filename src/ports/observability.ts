// Observability port — domain event emission
// Implementations: src/adapters/composite-observability.ts,
//   console-logger.ts, trace-writer.ts, heartbeat-writer.ts

import type { DomainEvent } from "../core/types.js";

/**
 * Synchronous, fire-and-forget domain event bus.
 * Implementations must never throw — swallow errors internally.
 */
export interface Observability {
  /** Emit a domain event. Must not throw. */
  emit(event: DomainEvent): void;
}
