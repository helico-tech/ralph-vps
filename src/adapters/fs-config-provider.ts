import { join, dirname } from "node:path";
import { access } from "node:fs/promises";
import type { ConfigProvider, EnvironmentType } from "../ports/config-provider";
import type { ProjectConfig, NodeConfig, ClientConfig } from "../domain/config";
import {
  ProjectConfig as ProjectConfigSchema,
  NodeConfig as NodeConfigSchema,
  ClientConfig as ClientConfigSchema,
} from "../domain/config";
import {
  PROJECT_CONFIG_FILE,
  NODE_CONFIG_FILE,
  CLIENT_CONFIG_FILE,
  RALPH_DIR,
} from "../constants";
import { ConfigError } from "../errors";

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function fileExists(path: string): Promise<boolean> {
  return Bun.file(path).exists();
}

async function readJson(path: string): Promise<unknown> {
  try {
    return await Bun.file(path).json();
  } catch (e) {
    throw new ConfigError(`Failed to read config at ${path}`, path, e);
  }
}

async function findRalphDir(startDir: string): Promise<string | null> {
  let dir = startDir;
  const root = "/";

  while (true) {
    const candidate = join(dir, RALPH_DIR);
    if (await pathExists(candidate)) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir || dir === root) break;
    dir = parent;
  }
  return null;
}

export class FsConfigProvider implements ConfigProvider {
  async detectEnvironment(startDir?: string): Promise<EnvironmentType> {
    const dir = startDir ?? process.cwd();
    const projectRoot = await findRalphDir(dir);
    if (!projectRoot) return null;

    // Check in order of specificity: project > node > client
    if (await fileExists(join(projectRoot, PROJECT_CONFIG_FILE))) return "project";
    if (await fileExists(join(projectRoot, NODE_CONFIG_FILE))) return "node";
    if (await fileExists(join(projectRoot, CLIENT_CONFIG_FILE))) return "client";

    return null;
  }

  async loadProjectConfig(startDir?: string): Promise<ProjectConfig | null> {
    const dir = startDir ?? process.cwd();
    const projectRoot = await findRalphDir(dir);
    if (!projectRoot) return null;

    const configPath = join(projectRoot, PROJECT_CONFIG_FILE);
    if (!(await fileExists(configPath))) return null;

    const raw = await readJson(configPath);
    const result = ProjectConfigSchema.safeParse(raw);
    if (!result.success) {
      throw new ConfigError(
        `Invalid project config: ${result.error.issues.map((i) => i.message).join(", ")}`,
        configPath
      );
    }
    return result.data;
  }

  async loadNodeConfig(startDir?: string): Promise<NodeConfig | null> {
    const dir = startDir ?? process.cwd();
    const projectRoot = await findRalphDir(dir);
    if (!projectRoot) return null;

    const configPath = join(projectRoot, NODE_CONFIG_FILE);
    if (!(await fileExists(configPath))) return null;

    const raw = await readJson(configPath);
    const result = NodeConfigSchema.safeParse(raw);
    if (!result.success) {
      throw new ConfigError(
        `Invalid node config: ${result.error.issues.map((i) => i.message).join(", ")}`,
        configPath
      );
    }
    return result.data;
  }

  async loadClientConfig(startDir?: string): Promise<ClientConfig | null> {
    const dir = startDir ?? process.cwd();
    const projectRoot = await findRalphDir(dir);
    if (!projectRoot) return null;

    const configPath = join(projectRoot, CLIENT_CONFIG_FILE);
    if (!(await fileExists(configPath))) return null;

    const raw = await readJson(configPath);
    const result = ClientConfigSchema.safeParse(raw);
    if (!result.success) {
      throw new ConfigError(
        `Invalid client config: ${result.error.issues.map((i) => i.message).join(", ")}`,
        configPath
      );
    }
    return result.data;
  }

  async getProjectRoot(startDir?: string): Promise<string | null> {
    const dir = startDir ?? process.cwd();
    return findRalphDir(dir);
  }
}
