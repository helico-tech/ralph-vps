import "./setup";
import { describe, expect, test } from "bun:test";

// This test requires Docker with SSH container.
// Run with: bun test:integration
describe("Remote control E2E (Docker)", () => {
  test.todo("client config → SSH → node commands → verify output", () => {});
});
