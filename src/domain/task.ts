import { z } from "zod";

export const TaskStatus = z.enum([
  "pending",
  "in_progress",
  "completed",
  "cancelled",
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const TaskType = z.enum([
  "feature-dev",
  "bug-fix",
  "research",
  "review",
]);
export type TaskType = z.infer<typeof TaskType>;

export const TaskFrontmatter = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  status: TaskStatus.default("pending"),
  type: TaskType.default("feature-dev"),
  priority: z.number().int().min(1).max(4).default(2),
  order: z.number().int().default(0),
  parent: z.string().optional(),
  depends_on: z.array(z.string()).default([]),
  created: z.string().datetime(),
  reviews: z.string().optional(),
});
export type TaskFrontmatter = z.infer<typeof TaskFrontmatter>;

export interface Task extends TaskFrontmatter {
  body: string;
  filePath: string;
}

const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled", "pending"],
  completed: [],
  cancelled: ["pending"],
};

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function generateTaskId(title: string, now?: Date): string {
  const date = now ?? new Date();
  const timestamp = date.toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const slug = slugify(title);
  return `${timestamp}-${slug}`;
}

export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TRANSITIONS[from].includes(to);
}

export function transitionTask(task: Task, newStatus: TaskStatus): Task {
  if (!isValidTransition(task.status, newStatus)) {
    throw new Error(
      `Invalid transition: ${task.status} → ${newStatus}`
    );
  }
  return { ...task, status: newStatus };
}

export function areDependenciesMet(task: Task, allTasks: Task[]): boolean {
  if (task.depends_on.length === 0) return true;

  return task.depends_on.every((depId) => {
    const dep = allTasks.find((t) => t.id === depId);
    return dep?.status === "completed";
  });
}
