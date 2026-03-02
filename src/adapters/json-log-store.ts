import { join } from "node:path";
import { readdir, mkdir } from "node:fs/promises";
import type { IterationLog } from "../domain/log";
import { IterationLog as IterationLogSchema } from "../domain/log";
import type { LogStore } from "../ports/log-store";
import { LOGS_DIR, LOG_FILE_EXTENSION } from "../constants";
import { slugify } from "../domain/task";

export class JsonLogStore implements LogStore {
  constructor(private readonly projectRoot: string) {}

  private get logsDir(): string {
    return join(this.projectRoot, LOGS_DIR);
  }

  async write(log: IterationLog): Promise<void> {
    await this.ensureDir();
    const timestamp = new Date(log.startedAt)
      .toISOString()
      .replace(/[-:T]/g, "")
      .slice(0, 14);
    const slug = slugify(log.taskTitle);
    const filename = `${timestamp}-${slug}${LOG_FILE_EXTENSION}`;
    const filePath = join(this.logsDir, filename);
    await Bun.write(filePath, JSON.stringify(log, null, 2));
  }

  async readLatest(count = 10): Promise<IterationLog[]> {
    const all = await this.listAll();
    return all.slice(-count);
  }

  async readByIteration(iteration: number): Promise<IterationLog | null> {
    const all = await this.listAll();
    return all.find((l) => l.iteration === iteration) ?? null;
  }

  async listAll(): Promise<IterationLog[]> {
    await this.ensureDir();
    let files: string[];
    try {
      files = await readdir(this.logsDir);
    } catch {
      return [];
    }

    const jsonFiles = files
      .filter((f) => f.endsWith(LOG_FILE_EXTENSION))
      .sort();
    const logs: IterationLog[] = [];

    for (const file of jsonFiles) {
      const filePath = join(this.logsDir, file);
      const raw = await Bun.file(filePath).json();
      const result = IterationLogSchema.safeParse(raw);
      if (result.success) {
        logs.push(result.data);
      }
    }

    return logs;
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.logsDir, { recursive: true });
  }
}
