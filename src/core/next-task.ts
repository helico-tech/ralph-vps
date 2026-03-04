// Next-task rules — pure function, zero I/O
// Determines what follow-up tasks to create after a task completes.

import type { Task } from "./types.js";

export interface NextTaskResult {
  followUps: Task[];
  shouldMerge: boolean;
}

/**
 * Determine follow-up tasks after a task completes or fails.
 *
 * Rules:
 *   feature/bugfix passes → create review task
 *   review passes         → merge branch, no follow-ups
 *   review fails          → create fix task
 *   fix passes            → create review task
 *   fix fails             → dead end
 */
export function buildNextTasks(
  task: Task,
  passed: boolean,
  nextId: string,
): NextTaskResult {
  const { type } = task;

  if (type === "feature" || type === "bugfix") {
    if (!passed) return { followUps: [], shouldMerge: false };
    return {
      followUps: [makeReviewTask(nextId, task)],
      shouldMerge: false,
    };
  }

  if (type === "review") {
    if (passed) return { followUps: [], shouldMerge: true };
    return {
      followUps: [makeFixTask(nextId, task)],
      shouldMerge: false,
    };
  }

  if (type === "fix") {
    if (!passed) return { followUps: [], shouldMerge: false };
    return {
      followUps: [makeReviewTask(nextId, task)],
      shouldMerge: false,
    };
  }

  return { followUps: [], shouldMerge: false };
}

/**
 * Resolve the branch name for a task.
 * All tasks in a chain share the same branch, named after the root feature/bugfix task.
 */
export function resolveBranchName(task: Task, branchPrefix: string): string {
  if ((task.type === "review" || task.type === "fix") && task.root_task_id) {
    return `${branchPrefix}${task.root_task_id as string}`;
  }
  if ((task.type === "review" || task.type === "fix") && task.parent_id) {
    // Fallback for tasks without root_task_id (first-gen review)
    return `${branchPrefix}${task.parent_id}`;
  }
  return `${branchPrefix}${task.id}`;
}

function resolveRootId(parent: Task): string {
  // Propagate root: if parent already has a root_task_id, use it.
  // Otherwise the parent IS the root (feature/bugfix).
  return (parent.root_task_id as string) ?? parent.id;
}

function makeReviewTask(id: string, parent: Task): Task {
  const commitRef = parent.commit_hash ? `\nCommit: \`${parent.commit_hash}\`` : "";
  return {
    id,
    type: "review",
    priority: parent.priority,
    parent_id: parent.id,
    root_task_id: resolveRootId(parent),
    status: "pending",
    description: [
      `Review the changes from task \`${parent.id}\` (${parent.type}).`,
      commitRef,
      "",
      "Check correctness, completeness, and consistency with the codebase.",
    ].join("\n").trim(),
  };
}

function makeFixTask(id: string, parent: Task): Task {
  return {
    id,
    type: "fix",
    priority: parent.priority,
    parent_id: parent.id,
    root_task_id: resolveRootId(parent),
    status: "pending",
    description: [
      `Fix issues found during review task \`${parent.id}\`.`,
      "",
      "## Review feedback",
      "",
      parent.description,
    ].join("\n"),
  };
}
