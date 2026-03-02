import type { ProjectConfig, NodeConfig, ClientConfig } from "../domain/config";

export type EnvironmentType = "project" | "node" | "client" | null;

export interface ConfigProvider {
  detectEnvironment(startDir?: string): Promise<EnvironmentType>;
  loadProjectConfig(startDir?: string): Promise<ProjectConfig | null>;
  loadNodeConfig(startDir?: string): Promise<NodeConfig | null>;
  loadClientConfig(startDir?: string): Promise<ClientConfig | null>;
  getProjectRoot(startDir?: string): Promise<string | null>;
}
