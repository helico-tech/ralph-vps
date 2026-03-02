import type { Task } from "../../domain/task";
import type { IterationLog } from "../../domain/log";
import type { ProjectConfig, NodeConfig, ClientConfig } from "../../domain/config";
import type { TaskRepository } from "../../ports/task-repository";
import type { TaskSelector } from "../../ports/task-selector";
import type { ConfigProvider, EnvironmentType } from "../../ports/config-provider";
import type { LogStore } from "../../ports/log-store";
import type { ProcessRunner, ProcessRunOptions, ProcessRunResult } from "../../ports/process-runner";
import type { RemoteExecutor, RemoteExecuteOptions, RemoteExecuteResult } from "../../ports/remote-executor";
import type { PromptCompiler, CompileContext, CompiledPrompt } from "../../ports/prompt-compiler";
import type { ProgressDetector, PreState, ProgressResult } from "../../ports/progress-detector";
import type { GitSynchronizer, SyncResult } from "../../ports/git-synchronizer";

export class MockTaskRepository implements TaskRepository {
  tasks: Task[] = [];

  async list(): Promise<Task[]> {
    return [...this.tasks];
  }

  async get(id: string): Promise<Task | null> {
    return this.tasks.find((t) => t.id === id) ?? null;
  }

  async save(task: Task): Promise<void> {
    const idx = this.tasks.findIndex((t) => t.id === task.id);
    if (idx >= 0) this.tasks[idx] = task;
  }

  async create(task: Task): Promise<void> {
    this.tasks.push(task);
  }

  async delete(id: string): Promise<void> {
    this.tasks = this.tasks.filter((t) => t.id !== id);
  }
}

export class MockTaskSelector implements TaskSelector {
  nextTask: Task | null = null;

  selectNext(_tasks: Task[]): Task | null {
    return this.nextTask;
  }
}

export class MockConfigProvider implements ConfigProvider {
  environment: EnvironmentType = null;
  projectConfig: ProjectConfig | null = null;
  nodeConfig: NodeConfig | null = null;
  clientConfig: ClientConfig | null = null;
  projectRoot: string | null = null;

  async detectEnvironment(): Promise<EnvironmentType> {
    return this.environment;
  }

  async loadProjectConfig(): Promise<ProjectConfig | null> {
    return this.projectConfig;
  }

  async loadNodeConfig(): Promise<NodeConfig | null> {
    return this.nodeConfig;
  }

  async loadClientConfig(): Promise<ClientConfig | null> {
    return this.clientConfig;
  }

  async getProjectRoot(): Promise<string | null> {
    return this.projectRoot;
  }
}

export class MockLogStore implements LogStore {
  logs: IterationLog[] = [];

  async write(log: IterationLog): Promise<void> {
    this.logs.push(log);
  }

  async readLatest(count = 10): Promise<IterationLog[]> {
    return this.logs.slice(-count);
  }

  async readByIteration(iteration: number): Promise<IterationLog | null> {
    return this.logs.find((l) => l.iteration === iteration) ?? null;
  }

  async listAll(): Promise<IterationLog[]> {
    return [...this.logs];
  }
}

export class MockProcessRunner implements ProcessRunner {
  result: ProcessRunResult = {
    exitCode: 0,
    inputTokens: 10000,
    outputTokens: 2000,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    toolCalls: 15,
    model: "claude-sonnet-4-6",
    durationMs: 60000,
  };
  lastOptions: ProcessRunOptions | null = null;

  async run(options: ProcessRunOptions): Promise<ProcessRunResult> {
    this.lastOptions = options;
    return this.result;
  }
}

export class MockRemoteExecutor implements RemoteExecutor {
  result: RemoteExecuteResult = { exitCode: 0, stdout: "", stderr: "" };
  lastOptions: RemoteExecuteOptions | null = null;

  async execute(options: RemoteExecuteOptions): Promise<RemoteExecuteResult> {
    this.lastOptions = options;
    return this.result;
  }

  async *stream(options: RemoteExecuteOptions): AsyncIterable<string> {
    this.lastOptions = options;
    yield this.result.stdout;
  }
}

export class MockPromptCompiler implements PromptCompiler {
  lastTask: Task | null = null;

  compile(task: Task, _typePromptTemplate: string, _context: CompileContext): CompiledPrompt {
    this.lastTask = task;
    return {
      prompt: `Mock prompt for: ${task.title}`,
      flags: ["--verbose", "--output-format", "stream-json"],
    };
  }
}

export class MockProgressDetector implements ProgressDetector {
  preState: PreState = { commitHash: "abc123", taskFileHashes: {} };
  progressResult: ProgressResult = {
    commitsMade: 1,
    filesChanged: 3,
    isDirty: false,
    newCommitHash: "def456",
  };

  async recordPreState(_cwd: string): Promise<PreState> {
    return this.preState;
  }

  async detectProgress(_cwd: string, _preState: PreState): Promise<ProgressResult> {
    return this.progressResult;
  }
}

export class MockGitSynchronizer implements GitSynchronizer {
  syncResult: SyncResult = { success: true };
  isCleanResult = true;
  currentHash = "abc123";
  lastCommitMessage: string | null = null;

  async pull(_cwd: string): Promise<SyncResult> {
    return this.syncResult;
  }

  async commitAndPush(_cwd: string, message: string): Promise<SyncResult> {
    this.lastCommitMessage = message;
    return this.syncResult;
  }

  async isClean(_cwd: string): Promise<boolean> {
    return this.isCleanResult;
  }

  async getCurrentHash(_cwd: string): Promise<string> {
    return this.currentHash;
  }
}
