import type { Task } from "./task";
import type { IterationLog } from "./log";
import { transitionTask } from "./task";
import { estimateCost } from "./log";
import {
  type LoopStatus,
  type CircuitBreakerConfig,
  type IterationResult,
  type CircuitBreakerTrip,
  initialLoopStatus,
  checkCircuitBreakers,
  updateLoopStatus,
} from "./loop";
import type { TaskRepository } from "../ports/task-repository";
import type { TaskSelector } from "../ports/task-selector";
import type { PromptCompiler, CompileContext } from "../ports/prompt-compiler";
import type { ProcessRunner } from "../ports/process-runner";
import type { ProgressDetector } from "../ports/progress-detector";
import type { GitSynchronizer } from "../ports/git-synchronizer";
import type { LogStore } from "../ports/log-store";
import type { FsTypeResolver } from "../adapters/fs-type-resolver";

export interface LoopEngineDeps {
  taskRepository: TaskRepository;
  taskSelector: TaskSelector;
  promptCompiler: PromptCompiler;
  processRunner: ProcessRunner;
  progressDetector: ProgressDetector;
  gitSynchronizer: GitSynchronizer;
  logStore: LogStore;
  typeResolver: FsTypeResolver;
  projectName: string;
  projectRoot: string;
  circuitBreakerConfig: CircuitBreakerConfig;
  reviewAfterCompletion: boolean;
  onIterationComplete?: (status: LoopStatus, result: IterationResult) => void;
}

export class LoopEngine {
  private status: LoopStatus;
  private deps: LoopEngineDeps;

  constructor(deps: LoopEngineDeps, initialStatus?: LoopStatus) {
    this.deps = deps;
    this.status = initialStatus ?? initialLoopStatus();
  }

  getStatus(): LoopStatus {
    return { ...this.status };
  }

  async runIteration(): Promise<IterationResult> {
    const startTime = Date.now();

    // 1. Pull latest
    this.status.phase = "pulling";
    const pullResult = await this.deps.gitSynchronizer.pull(this.deps.projectRoot);
    if (!pullResult.success) {
      return this.errorResult(startTime, null, `Git pull failed: ${pullResult.error}`);
    }

    // 2. Select task
    this.status.phase = "selecting";
    const tasks = await this.deps.taskRepository.list();
    const task = this.deps.taskSelector.selectNext(tasks);
    if (!task) {
      return this.errorResult(startTime, null, "No eligible tasks");
    }

    // 3. Transition to in_progress
    const startedTask = transitionTask(task, "in_progress");
    await this.deps.taskRepository.save(startedTask);

    // 4. Record pre-state
    const preState = await this.deps.progressDetector.recordPreState(this.deps.projectRoot);

    // 5. Compile prompt
    this.status.phase = "compiling";
    const typeDef = await this.deps.typeResolver.resolve(task.type);
    const typePromptTemplate = typeDef?.promptTemplate ?? "";
    const context: CompileContext = {
      iteration: this.status.iteration + 1,
      projectName: this.deps.projectName,
    };
    const compiled = this.deps.promptCompiler.compile(startedTask, typePromptTemplate, context);

    // 6. Execute
    this.status.phase = "executing";
    this.status.currentTaskId = task.id;
    const processResult = await this.deps.processRunner.run({
      prompt: compiled.prompt,
      flags: compiled.flags,
      cwd: this.deps.projectRoot,
    });

    // 7. Collect results
    this.status.phase = "collecting";
    const progress = await this.deps.progressDetector.detectProgress(this.deps.projectRoot, preState);
    const costUsd = estimateCost(processResult.model, {
      input: processResult.inputTokens,
      output: processResult.outputTokens,
    });

    // 8. Determine task completion
    const success = processResult.exitCode === 0 && !processResult.error;

    // Write iteration log
    const iterationLog: IterationLog = {
      iteration: this.status.iteration + 1,
      taskId: task.id,
      taskTitle: task.title,
      type: task.type,
      startedAt: new Date(startTime).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - startTime,
      model: processResult.model,
      inputTokens: processResult.inputTokens,
      outputTokens: processResult.outputTokens,
      cacheReadTokens: processResult.cacheReadTokens,
      cacheWriteTokens: processResult.cacheWriteTokens,
      toolCalls: processResult.toolCalls,
      costUsd,
      commitsMade: progress.commitsMade,
      filesChanged: progress.filesChanged,
      success,
      error: processResult.error,
      preCommitHash: preState.commitHash,
      postCommitHash: progress.newCommitHash,
    };
    await this.deps.logStore.write(iterationLog);

    // 9. Push
    this.status.phase = "pushing";
    await this.deps.gitSynchronizer.commitAndPush(
      this.deps.projectRoot,
      `ralph: iteration ${this.status.iteration + 1} — ${task.title}`
    );

    this.status.phase = "idle";

    return {
      success,
      taskId: task.id,
      tokensUsed: processResult.inputTokens + processResult.outputTokens,
      costUsd,
      durationMs: Date.now() - startTime,
      error: processResult.error,
      commitsMade: progress.commitsMade,
      filesChanged: progress.filesChanged,
    };
  }

  async run(signal?: AbortSignal): Promise<CircuitBreakerTrip | "no_tasks" | "aborted"> {
    while (!signal?.aborted) {
      // Check circuit breakers before iteration
      const trip = checkCircuitBreakers(this.status, this.deps.circuitBreakerConfig);
      if (trip) return trip;

      const result = await this.runIteration();

      if (!result.success && result.error === "No eligible tasks") {
        return "no_tasks";
      }

      // Update status
      this.status = updateLoopStatus(this.status, result);

      // Notify listener
      this.deps.onIterationComplete?.(this.getStatus(), result);
    }

    return "aborted";
  }

  private errorResult(startTime: number, taskId: string | null, error: string): IterationResult {
    return {
      success: false,
      taskId,
      tokensUsed: 0,
      costUsd: 0,
      durationMs: Date.now() - startTime,
      error,
      commitsMade: 0,
      filesChanged: 0,
    };
  }
}
