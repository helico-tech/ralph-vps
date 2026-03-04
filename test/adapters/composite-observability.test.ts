import { describe, it, expect } from "bun:test";
import { CompositeObservability } from "../../src/adapters/composite-observability.js";
import { MockObservability } from "../../src/adapters/mock/mock-observability.js";
import type { DomainEvent } from "../../src/core/types.js";
import type { Observability } from "../../src/ports/observability.js";

function makeEvent(): DomainEvent {
  return { type: "task.claimed", task_id: "t1", timestamp: "2026-03-03T12:00:00Z" };
}

describe("CompositeObservability", () => {
  it("fans out events to all children", () => {
    const a = new MockObservability();
    const b = new MockObservability();
    const composite = new CompositeObservability([a, b]);

    composite.emit(makeEvent());

    expect(a.events).toHaveLength(1);
    expect(b.events).toHaveLength(1);
  });

  it("delivers multiple events in order", () => {
    const spy = new MockObservability();
    const composite = new CompositeObservability([spy]);

    const e1: DomainEvent = { type: "task.claimed", task_id: "t1", timestamp: "2026-03-03T12:00:00Z" };
    const e2: DomainEvent = { type: "task.completed", task_id: "t1", timestamp: "2026-03-03T13:00:00Z" };

    composite.emit(e1);
    composite.emit(e2);

    expect(spy.events).toHaveLength(2);
    expect(spy.events[0].type).toBe("task.claimed");
    expect(spy.events[1].type).toBe("task.completed");
  });

  it("isolates errors — other children still receive the event", () => {
    const good = new MockObservability();
    const bad: Observability = {
      emit() { throw new Error("I broke"); },
    };
    const alsoGood = new MockObservability();

    const composite = new CompositeObservability([good, bad, alsoGood]);
    composite.emit(makeEvent());

    expect(good.events).toHaveLength(1);
    expect(alsoGood.events).toHaveLength(1);
  });

  it("works with zero children", () => {
    const composite = new CompositeObservability([]);
    composite.emit(makeEvent());
  });
});

describe("MockObservability — ofType helper", () => {
  it("filters events by type", () => {
    const spy = new MockObservability();
    spy.emit({ type: "task.claimed", task_id: "t1", timestamp: "now" });
    spy.emit({ type: "task.failed", task_id: "t1", timestamp: "now", reason: "oops" });
    spy.emit({ type: "task.claimed", task_id: "t2", timestamp: "now" });

    const claimed = spy.ofType("task.claimed");
    expect(claimed).toHaveLength(2);

    const failed = spy.ofType("task.failed");
    expect(failed).toHaveLength(1);
    expect(failed[0].reason).toBe("oops");
  });
});
