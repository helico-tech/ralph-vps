import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { FsConfigProvider } from "../fs-config-provider";
import { createTempDir, cleanupTempDir } from "../../__tests__/helpers";
import { RALPH_DIR, PROJECT_CONFIG_FILE, NODE_CONFIG_FILE, CLIENT_CONFIG_FILE } from "../../constants";

let tmpDir: string;
let provider: FsConfigProvider;

beforeEach(async () => {
  tmpDir = await createTempDir();
  provider = new FsConfigProvider();
});

afterEach(async () => {
  await cleanupTempDir(tmpDir);
});

async function writeJson(path: string, data: unknown) {
  await mkdir(join(tmpDir, RALPH_DIR), { recursive: true });
  await Bun.write(join(tmpDir, path), JSON.stringify(data));
}

describe("FsConfigProvider", () => {
  describe("detectEnvironment", () => {
    test("returns null when no .ralph dir", async () => {
      expect(await provider.detectEnvironment(tmpDir)).toBeNull();
    });

    test("detects project environment", async () => {
      await writeJson(PROJECT_CONFIG_FILE, { name: "test" });
      expect(await provider.detectEnvironment(tmpDir)).toBe("project");
    });

    test("detects node environment", async () => {
      await writeJson(NODE_CONFIG_FILE, { hostname: "vps-1" });
      expect(await provider.detectEnvironment(tmpDir)).toBe("node");
    });

    test("detects client environment", async () => {
      await writeJson(CLIENT_CONFIG_FILE, { nodes: {} });
      expect(await provider.detectEnvironment(tmpDir)).toBe("client");
    });

    test("project takes precedence over node", async () => {
      await writeJson(PROJECT_CONFIG_FILE, { name: "test" });
      await writeJson(NODE_CONFIG_FILE, { hostname: "vps" });
      expect(await provider.detectEnvironment(tmpDir)).toBe("project");
    });

    test("walks up directory tree", async () => {
      await writeJson(PROJECT_CONFIG_FILE, { name: "test" });
      const subDir = join(tmpDir, "deep", "nested");
      await mkdir(subDir, { recursive: true });
      expect(await provider.detectEnvironment(subDir)).toBe("project");
    });
  });

  describe("loadProjectConfig", () => {
    test("returns null when not found", async () => {
      expect(await provider.loadProjectConfig(tmpDir)).toBeNull();
    });

    test("loads and validates project config", async () => {
      await writeJson(PROJECT_CONFIG_FILE, { name: "my-project" });
      const config = await provider.loadProjectConfig(tmpDir);
      expect(config).not.toBeNull();
      expect(config!.name).toBe("my-project");
      expect(config!.defaultType).toBe("feature-dev"); // default
    });

    test("throws on invalid config", async () => {
      await writeJson(PROJECT_CONFIG_FILE, { invalid: true });
      await expect(provider.loadProjectConfig(tmpDir)).rejects.toThrow();
    });
  });

  describe("loadNodeConfig", () => {
    test("loads node config with defaults", async () => {
      await writeJson(NODE_CONFIG_FILE, { hostname: "vps-1" });
      const config = await provider.loadNodeConfig(tmpDir);
      expect(config!.hostname).toBe("vps-1");
      expect(config!.projectsDir).toBe("/home/ralph/projects");
    });
  });

  describe("loadClientConfig", () => {
    test("loads client config with nodes", async () => {
      await writeJson(CLIENT_CONFIG_FILE, {
        nodes: { "vps-1": { host: "10.0.0.1" } },
      });
      const config = await provider.loadClientConfig(tmpDir);
      expect(config!.nodes["vps-1"].host).toBe("10.0.0.1");
      expect(config!.nodes["vps-1"].user).toBe("ralph"); // default
    });
  });

  describe("getProjectRoot", () => {
    test("returns null when no .ralph", async () => {
      expect(await provider.getProjectRoot(tmpDir)).toBeNull();
    });

    test("returns root dir containing .ralph", async () => {
      await mkdir(join(tmpDir, RALPH_DIR), { recursive: true });
      const subDir = join(tmpDir, "sub");
      await mkdir(subDir, { recursive: true });
      expect(await provider.getProjectRoot(subDir)).toBe(tmpDir);
    });
  });
});
