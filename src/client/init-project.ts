// Init project — scaffold .ralph/ directory and Claude Code skills in a target project

import { join, dirname } from "path";
import { mkdir, readdir, copyFile } from "fs/promises";

export interface InitOptions {
  name: string;
  testCmd: string;
  mainBranch?: string;
}

export interface InitResult {
  created: string[];
  skipped: string[];
}

function resolveRalphRoot(): string {
  return dirname(dirname(import.meta.dir));
}

export async function initProject(targetDir: string, options: InitOptions): Promise<InitResult> {
  const ralphRoot = resolveRalphRoot();
  const created: string[] = [];
  const skipped: string[] = [];

  // --- 1. Task directories ---
  const statuses = ["pending", "active", "done", "failed"];
  for (const status of statuses) {
    const dir = join(targetDir, ".ralph", "tasks", status);
    const result = await ensureDir(dir);
    (result === "created" ? created : skipped).push(`.ralph/tasks/${status}/`);
  }

  // --- 2. Config ---
  const configPath = join(targetDir, ".ralph", "config.json");
  const configResult = await writeIfMissing(configPath, generateConfig(options));
  (configResult === "created" ? created : skipped).push(".ralph/config.json");

  // --- 3. Templates ---
  const templatesDir = join(targetDir, ".ralph", "templates");
  await ensureDir(templatesDir);
  const sourceTemplates = join(ralphRoot, "templates");
  await copyDir(sourceTemplates, templatesDir, created, skipped, ".ralph/templates/");

  // --- 4. System prompt ---
  const systemPromptSrc = join(ralphRoot, "templates", "ralph-system.md");
  const systemPromptDest = join(targetDir, ".ralph", "ralph-system.md");
  const spResult = await copyIfMissing(systemPromptSrc, systemPromptDest);
  (spResult === "created" ? created : skipped).push(".ralph/ralph-system.md");

  // --- 5. Skills ---
  const skillsSourceDir = join(ralphRoot, ".claude", "skills");
  const skillNames = ["ralph-task", "ralph-status", "ralph-list"];
  for (const skill of skillNames) {
    const destDir = join(targetDir, ".claude", "skills", skill);
    await ensureDir(destDir);
    const src = join(skillsSourceDir, skill, "SKILL.md");
    const dest = join(destDir, "SKILL.md");
    const result = await copyIfMissing(src, dest);
    (result === "created" ? created : skipped).push(`.claude/skills/${skill}/SKILL.md`);
  }

  return { created, skipped };
}

function generateConfig(options: InitOptions): string {
  const config = {
    version: 1,
    project: { name: options.name },
    verify: options.testCmd,
    task_defaults: {
      model: "claude-opus-4-5",
      max_turns: 50,
      timeout_seconds: 1800,
    },
    git: {
      main_branch: options.mainBranch ?? "main",
      branch_prefix: "ralph/",
    },
    execution: {
      permission_mode: "skip_all",
    },
  };
  return JSON.stringify(config, null, 2) + "\n";
}

async function ensureDir(path: string): Promise<"created" | "skipped"> {
  try {
    const file = Bun.file(join(path, ".gitkeep"));
    if (await file.exists()) return "skipped";
  } catch { /* directory doesn't exist yet */ }

  await mkdir(path, { recursive: true });
  await Bun.write(join(path, ".gitkeep"), "");
  return "created";
}

async function writeIfMissing(path: string, content: string): Promise<"created" | "skipped"> {
  const file = Bun.file(path);
  if (await file.exists()) return "skipped";
  await mkdir(dirname(path), { recursive: true });
  await Bun.write(path, content);
  return "created";
}

async function copyIfMissing(src: string, dest: string): Promise<"created" | "skipped"> {
  const destFile = Bun.file(dest);
  if (await destFile.exists()) return "skipped";
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(src, dest);
  return "created";
}

async function copyDir(
  srcDir: string,
  destDir: string,
  created: string[],
  skipped: string[],
  prefix: string,
): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(srcDir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry === "ralph-system.md") continue;

    const src = join(srcDir, entry);
    const dest = join(destDir, entry);
    const result = await copyIfMissing(src, dest);
    (result === "created" ? created : skipped).push(`${prefix}${entry}`);
  }
}
