import { join } from "node:path";
import type { Command } from "commander";
import { generateTaskId, slugify } from "../../domain/task";
import type { Task, TaskType } from "../../domain/task";
import { FsTaskRepository } from "../../adapters/fs-task-repository";
import { PriorityTaskSelector } from "../../adapters/priority-task-selector";
import { FsTypeResolver } from "../../adapters/fs-type-resolver";
import { TASKS_DIR } from "../../constants";

export function registerTaskCommands(
  program: Command,
  projectRoot: string
): void {
  const task = program
    .command("task")
    .description("Manage tasks");

  const repo = new FsTaskRepository(projectRoot);
  const selector = new PriorityTaskSelector();
  const typeResolver = new FsTypeResolver(projectRoot);

  task
    .command("add")
    .description("Add a new task")
    .argument("<title>", "Task title")
    .option("-t, --type <type>", "Task type", "feature-dev")
    .option("-p, --priority <n>", "Priority (1-4, lower = higher)", "2")
    .option("--parent <label>", "Parent label for grouping")
    .option("--depends-on <ids...>", "Task IDs this depends on")
    .option("--order <n>", "Sort order within same priority", "0")
    .action(async (title: string, opts) => {
      const now = new Date();
      const id = generateTaskId(title, now);
      const slug = slugify(title);
      const filePath = join(projectRoot, TASKS_DIR, `${slug}.md`);

      // Load template body if available
      let body = "";
      const typeDef = await typeResolver.resolve(opts.type);
      if (typeDef?.taskTemplate) {
        body = typeDef.taskTemplate;
      }

      const newTask: Task = {
        id,
        title,
        status: "pending",
        type: opts.type as TaskType,
        priority: parseInt(opts.priority, 10),
        order: parseInt(opts.order, 10),
        parent: opts.parent,
        depends_on: opts.dependsOn ?? [],
        created: now.toISOString(),
        body,
        filePath,
      };

      await repo.create(newTask);
      console.log(`Created task: ${id}`);
      console.log(`  File: ${filePath}`);
    });

  task
    .command("list")
    .description("List tasks")
    .option("-s, --status <status>", "Filter by status")
    .option("-t, --type <type>", "Filter by type")
    .option("--parent <label>", "Filter by parent label")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      let tasks = await repo.list();

      if (opts.status) {
        tasks = tasks.filter((t) => t.status === opts.status);
      }
      if (opts.type) {
        tasks = tasks.filter((t) => t.type === opts.type);
      }
      if (opts.parent) {
        tasks = tasks.filter((t) => t.parent === opts.parent);
      }

      // Sort by selection order
      tasks.sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        if (a.order !== b.order) return a.order - b.order;
        return a.created.localeCompare(b.created);
      });

      if (opts.json) {
        console.log(JSON.stringify(tasks, null, 2));
        return;
      }

      if (tasks.length === 0) {
        console.log("No tasks found.");
        return;
      }

      // Table output
      const header = padRow("ID", "TYPE", "PRI", "STATUS", "PARENT", "TITLE");
      console.log(header);
      console.log("-".repeat(header.length));

      for (const t of tasks) {
        console.log(
          padRow(
            t.id.slice(0, 20),
            t.type,
            String(t.priority),
            t.status,
            t.parent ?? "-",
            t.title.slice(0, 30)
          )
        );
      }

      console.log(`\n${tasks.length} task(s)`);
    });

  task
    .command("next")
    .description("Show the next task the loop would pick")
    .option("--json", "Output as JSON")
    .action(async (opts) => {
      const tasks = await repo.list();
      const next = selector.selectNext(tasks);

      if (!next) {
        console.log("No eligible tasks.");
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify(next, null, 2));
        return;
      }

      console.log(`Next task: ${next.id}`);
      console.log(`  Title:    ${next.title}`);
      console.log(`  Type:     ${next.type}`);
      console.log(`  Priority: ${next.priority}`);
      if (next.parent) {
        console.log(`  Parent:   ${next.parent}`);
      }
    });

  task
    .command("edit")
    .description("Edit a task in $EDITOR")
    .argument("<id>", "Task ID (prefix match)")
    .action(async (idPrefix: string) => {
      const tasks = await repo.list();
      const matches = tasks.filter((t) => t.id.startsWith(idPrefix));

      if (matches.length === 0) {
        console.error(`No task found matching "${idPrefix}"`);
        process.exit(1);
      }

      if (matches.length > 1) {
        console.error(`Ambiguous ID "${idPrefix}". Matches:`);
        for (const t of matches) {
          console.error(`  ${t.id} — ${t.title}`);
        }
        process.exit(1);
      }

      const task = matches[0];
      const editor = process.env.EDITOR || "vi";

      const proc = Bun.spawn([editor, task.filePath], {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
      });
      await proc.exited;

      // Validate after edit
      try {
        const { parseTask } = await import("../../domain/task-serialization");
        const raw = await Bun.file(task.filePath).text();
        parseTask(raw, task.filePath);
        console.log("Task validated successfully.");
      } catch (e) {
        console.error(`Warning: Task frontmatter validation failed: ${e}`);
      }
    });
}

function padRow(...cols: string[]): string {
  const widths = [22, 12, 4, 12, 12, 30];
  return cols.map((c, i) => c.padEnd(widths[i] ?? 10)).join(" ");
}
