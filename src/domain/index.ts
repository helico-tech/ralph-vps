export {
  type Task,
  type TaskStatus,
  type TaskType,
  TaskFrontmatter,
  TaskStatus as TaskStatusEnum,
  TaskType as TaskTypeEnum,
  slugify,
  generateTaskId,
  isValidTransition,
  transitionTask,
  areDependenciesMet,
} from "./task";

export {
  parseTask,
  serializeTask,
  parseFrontmatter,
} from "./task-serialization";

export {
  selectNextTask,
  getEligibleTasks,
  isTaskCompleted,
} from "./task-selection";

export {
  type LoopPhase,
  type LoopStatus,
  type CircuitBreakerConfig,
  type IterationResult,
  type CircuitBreakerTrip,
  initialLoopStatus,
  checkCircuitBreakers,
  updateLoopStatus,
  isProgress,
} from "./loop";

export {
  type ProjectConfig,
  type NodeConfig,
  type ClientConfig,
  ProjectConfig as ProjectConfigSchema,
  NodeConfig as NodeConfigSchema,
  ClientConfig as ClientConfigSchema,
  CircuitBreakerConfigSchema,
} from "./config";

export {
  type TypeDefinition,
  isValidTypeName,
} from "./types";

export {
  type IterationLog,
  type AggregateStats,
  IterationLog as IterationLogSchema,
  DEFAULT_PRICING,
  estimateCost,
  aggregateStats,
} from "./log";

export {
  type SyncManifest,
  type SyncAction,
  decideSyncAction,
  hashContent,
} from "./sync";

export {
  type Migration,
  MIGRATIONS,
  pendingMigrations,
} from "./migration";

export { LoopEngine, type LoopEngineDeps } from "./loop-engine";
