import "./setup";
import { describe, expect, test } from "bun:test";

// This test requires Docker + mock-claude.sh deployed to the container.
// Run with: bun test:integration
describe("Loop E2E (Docker)", () => {
  test.todo("runs one iteration with mock claude and verifies task status + log + state", () => {});
});
