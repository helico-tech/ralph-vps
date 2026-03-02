import { describe, expect, test } from "bun:test";
import { ProjectConfig, NodeConfig, ClientConfig } from "../config";
import { isValidTypeName } from "../types";

describe("ProjectConfig", () => {
  test("validates with all fields", () => {
    const result = ProjectConfig.safeParse({
      name: "my-project",
      circuitBreakers: {
        maxConsecutiveErrors: 5,
        maxStallIterations: 10,
        maxCostUsd: 20,
        maxTokens: 0,
        maxIterations: 0,
      },
      defaultType: "bug-fix",
      reviewAfterCompletion: false,
    });
    expect(result.success).toBe(true);
  });

  test("applies defaults", () => {
    const config = ProjectConfig.parse({ name: "test" });
    expect(config.defaultType).toBe("feature-dev");
    expect(config.reviewAfterCompletion).toBe(true);
    expect(config.circuitBreakers.maxConsecutiveErrors).toBe(3);
  });

  test("rejects missing name", () => {
    const result = ProjectConfig.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("NodeConfig", () => {
  test("validates with defaults", () => {
    const config = NodeConfig.parse({ hostname: "vps-1" });
    expect(config.projectsDir).toBe("/home/ralph/projects");
    expect(config.logsDir).toBe("/home/ralph/logs");
    expect(config.maxConcurrentLoops).toBe(1);
  });
});

describe("ClientConfig", () => {
  test("validates with nodes", () => {
    const config = ClientConfig.parse({
      nodes: {
        "vps-1": { host: "192.168.1.1", user: "ralph", port: 22 },
      },
    });
    expect(config.nodes["vps-1"].host).toBe("192.168.1.1");
  });

  test("defaults to empty nodes", () => {
    const config = ClientConfig.parse({});
    expect(config.nodes).toEqual({});
  });
});

describe("isValidTypeName", () => {
  test("accepts valid names", () => {
    expect(isValidTypeName("feature-dev")).toBe(true);
    expect(isValidTypeName("bug-fix")).toBe(true);
    expect(isValidTypeName("research")).toBe(true);
  });

  test("rejects invalid names", () => {
    expect(isValidTypeName("")).toBe(false);
    expect(isValidTypeName("Feature-Dev")).toBe(false);
    expect(isValidTypeName("123-start")).toBe(false);
    expect(isValidTypeName("has space")).toBe(false);
  });

  test("rejects names over 40 chars", () => {
    expect(isValidTypeName("a".repeat(41))).toBe(false);
  });
});
