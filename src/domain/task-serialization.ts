import matter from "gray-matter";
import type { Task } from "./task";
import { TaskFrontmatter } from "./task";
import { TaskValidationError } from "../errors";

export function parseFrontmatter(raw: string): Record<string, unknown> {
  const { data } = matter(raw);
  return data;
}

export function parseTask(raw: string, filePath: string): Task {
  const { data, content } = matter(raw);

  const result = TaskFrontmatter.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join(", ");
    throw new TaskValidationError(
      `Invalid task frontmatter in ${filePath}: ${issues}`,
      result.error.issues[0]?.path[0]?.toString()
    );
  }

  return {
    ...result.data,
    body: content.trim(),
    filePath,
  };
}

export function serializeTask(task: Task): string {
  const { body, filePath, ...frontmatter } = task;

  // Remove undefined optional fields
  const cleaned = Object.fromEntries(
    Object.entries(frontmatter).filter(([, v]) => v !== undefined)
  );

  return matter.stringify(body ? `\n${body}\n` : "\n", cleaned);
}
